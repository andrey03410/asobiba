import { type ConfigDocument, createCatalog, createRng, isActionError, presetDocument, simulate, validateConfig } from "@asobiba/sdk";
import { describe, expect, it } from "vitest";
import { type TttAction, type TttState, ticTacToe } from "./game";
import { PRESETS } from "./presets";
import type { TttRules } from "./rules";

const catalog = createCatalog([ticTacToe]);

function cfg(patch: Record<string, unknown> = {}): ConfigDocument<TttRules> {
  const res = validateConfig(catalog, { sdk: 1, game: "tic-tac-toe", gameVersion: 1, ...patch });
  if (!res.ok) throw new Error(JSON.stringify(res.issues, null, 2));
  return res.config as ConfigDocument<TttRules>;
}

function play(config: ConfigDocument<TttRules>, moves: Array<[number, number] | number>, firstSeat = 0) {
  const seats = config.rules.players;
  const ctx = { rules: config.rules, seats, rng: createRng(1), now: 0 };
  let state = ticTacToe.setup({ ...ctx, round: 1, firstSeat }) as TttState;
  for (const m of moves) {
    const seat = state.turnSeat;
    const action: TttAction = typeof m === "number" ? { type: "drop", col: m } : { type: "place", row: m[0], col: m[1] };
    const next = ticTacToe.applyAction(state, seat, action, ctx);
    if (isActionError(next)) throw new Error(`${JSON.stringify(m)}: ${next.error.code}`);
    state = next as TttState;
  }
  return { state, ctx };
}

describe("tic-tac-toe rules", () => {
  it("classic: the first line of three wins", () => {
    const { state } = play(cfg(), [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]]);
    expect(state.result).toMatchObject({ winners: [0], losers: [1], reason: "line" });
    expect(state.winLines).toEqual([[0, 1, 2]]);
  });

  it("detects both diagonals", () => {
    const d = play(cfg(), [[0, 0], [0, 1], [1, 1], [0, 2], [2, 2]]).state;
    expect(d.result?.winners).toEqual([0]);
    const a = play(cfg(), [[0, 2], [0, 0], [1, 1], [0, 1], [2, 0]]).state;
    expect(a.result?.winners).toEqual([0]);
  });

  it("ignores directions that are switched off", () => {
    const { state } = play(cfg({ rules: { win: { directions: ["horizontal", "vertical"] } } }), [[0, 0], [0, 1], [1, 1], [0, 2], [2, 2]]);
    expect(state.result).toBeNull();
  });

  it("misère: making a line loses", () => {
    const { state } = play(cfg({ rules: { win: { misere: true } } }), [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]]);
    expect(state.result).toMatchObject({ winners: [1], losers: [0] });
  });

  it("a full board without a line is a draw", () => {
    const { state } = play(cfg(), [[0, 0], [0, 1], [0, 2], [1, 1], [1, 0], [1, 2], [2, 1], [2, 0], [2, 2]]);
    expect(state.result).toMatchObject({ draw: true, reason: "board-full" });
  });

  it("gravity: pieces fall and four in a column wins", () => {
    const config = cfg({ rules: { board: { width: 7, height: 6 }, win: { line: 4 }, placement: "gravity" } });
    const { state } = play(config, [3, 4, 3, 4, 3, 4, 3]);
    expect(state.result?.winners).toEqual([0]);
    expect(state.cells[5 * 7 + 3]).toBe(0);
    expect(state.cells[2 * 7 + 3]).toBe(0);
  });

  it("gravity: a full column is rejected", () => {
    const config = cfg({ rules: { placement: "gravity", win: { directions: ["horizontal"] } } });
    const { state, ctx } = play(config, [0, 0, 0]);
    const res = ticTacToe.applyAction(state, state.turnSeat, { type: "drop", col: 0 }, ctx);
    expect(isActionError(res) && res.error.code).toBe("column_full");
  });

  it("blocked cells cannot be played and break lines", () => {
    const config = cfg({ rules: { board: { width: 4, height: 3, blocked: [[0, 2]] } } });
    const { state, ctx } = play(config, [[0, 0], [1, 0], [0, 1], [1, 1]]);
    const res = ticTacToe.applyAction(state, 0, { type: "place", row: 0, col: 2 }, ctx);
    expect(isActionError(res) && res.error.code).toBe("blocked");
  });

  it("three players take turns", () => {
    const config = cfg({ rules: { board: { width: 5, height: 5 }, players: 3 } });
    const { state } = play(config, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2]]);
    expect(state.result?.winners).toEqual([0]);
    expect(state.result?.losers).toEqual([1, 2]);
  });

  it("several moves per turn with a shorter first turn", () => {
    const config = cfg({ rules: { board: { width: 6, height: 6 }, win: { line: 5 }, turns: { movesPerTurn: 2, firstTurnMoves: 1 } } });
    const { state } = play(config, [[0, 0], [1, 0], [1, 1]]);
    expect(state.turnSeat).toBe(0);
    expect(state.movesLeft).toBe(2);
    expect(state.lastMoves.map((m) => m.seat)).toEqual([1, 1]);
  });

  it("most-lines: plays until the board is full and counts lines", () => {
    const config = cfg({ rules: { board: { width: 3, height: 3 }, win: { mode: "most-lines", directions: ["horizontal"] } } });
    // seat 0 fills row 0 and row 2 partially, seat 1 gets row 1
    const { state } = play(config, [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [2, 0], [2, 1], [2, 2]]);
    expect(state.lineCounts).toEqual([1, 1]);
    expect(state.result).toMatchObject({ draw: true, reason: "most-lines" });
  });

  it("view shows legal cells only to the seat to move", () => {
    const { state } = play(cfg(), [[1, 1]]);
    expect((ticTacToe.view(state, 1) as { legal: number[] }).legal).toHaveLength(8);
    expect((ticTacToe.view(state, 0) as { legal: number[] }).legal).toHaveLength(0);
    expect((ticTacToe.view(state, null) as { legal: number[] }).legal).toHaveLength(0);
  });
});

describe("tic-tac-toe config checks", () => {
  it("rejects a line longer than the board allows", () => {
    const res = validateConfig(catalog, { sdk: 1, game: "tic-tac-toe", gameVersion: 1, rules: { board: { width: 4, height: 4 }, win: { line: 5 } } });
    expect(res.ok).toBe(false);
    expect(res.issues[0]).toMatchObject({ path: "rules.win.line", code: "line_too_long" });
  });

  it("rejects blocked cells outside the board", () => {
    const res = validateConfig(catalog, { sdk: 1, game: "tic-tac-toe", gameVersion: 1, rules: { board: { blocked: [[5, 0]] } } });
    expect(res.ok).toBe(false);
    expect(res.issues[0]?.path).toBe("rules.board.blocked[0]");
  });

  it("warns, but accepts, an instant first-turn win", () => {
    const res = validateConfig(catalog, { sdk: 1, game: "tic-tac-toe", gameVersion: 1, rules: { turns: { movesPerTurn: 3 } } });
    expect(res.ok).toBe(true);
    expect(res.issues.map((i) => i.code)).toContain("instant_win");
  });

  it("rejects two seats with identical pieces", () => {
    const res = validateConfig(catalog, {
      sdk: 1,
      game: "tic-tac-toe",
      gameVersion: 1,
      visual: { pieces: [{ preset: "cat", color: "#ff0000" }, { preset: "cat", color: "#FF0000" }] },
    });
    expect(res.ok).toBe(false);
    expect(res.issues[0]).toMatchObject({ path: "visual.pieces[1]", code: "same_piece" });
  });

  it("accepts asset pieces and explains a malformed slot", () => {
    const ok = validateConfig(catalog, { sdk: 1, game: "tic-tac-toe", gameVersion: 1, visual: { pieces: [{ asset: "ast_abcdefgh123" }] } });
    expect(ok.ok).toBe(true);
    const bad = validateConfig(catalog, { sdk: 1, game: "tic-tac-toe", gameVersion: 1, visual: { pieces: [{ image: "x.png" }] } });
    expect(bad.ok).toBe(false);
    expect(bad.issues[0]?.message).toContain("asset");
  });
});

describe("tic-tac-toe presets", () => {
  for (const preset of PRESETS) {
    it(`${preset.id}: valid and playable by random players`, () => {
      const doc = presetDocument(ticTacToe, preset);
      const res = validateConfig(catalog, doc);
      expect(res.ok, JSON.stringify(res.issues)).toBe(true);
      const report = simulate(ticTacToe, doc, { rounds: 30 });
      expect(report.finished).toBe(30);
      expect(report.issues.filter((i) => i.code !== "always-draw")).toEqual([]);
    });
  }
});
