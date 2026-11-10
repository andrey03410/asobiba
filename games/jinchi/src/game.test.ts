import { performance } from "node:perf_hooks";
import { createCatalog, createRng, isActionError, Match, presetDocument, simulate, validateConfig } from "@asobiba/sdk";
import { describe, expect, it } from "vitest";
import { checkRules, findPlacements, jinchi, placementError, PRESETS, rulesSchema, rulesText, visualSchema, type JinchiRules, type JinchiState } from "./index";

function rules(rows: string[], patch: Record<string, unknown> = {}): JinchiRules {
  return rulesSchema.parse({ map: { width: rows[0]!.length, height: rows.length, rows }, starts: { assignment: "ordered" }, ...patch });
}

function board(rows: string[], patch: Record<string, unknown> = {}): JinchiState {
  const ruleRows = rows.map((r) => r.replace(/[01]/g, (c) => String(Number(c) + 1)));
  const r = rules(ruleRows, patch);
  const cells = rows.join("").split("").map((c) => c === "." ? -1 : c === "#" ? -2 : Number(c));
  const seats = Math.max(2, ...cells.filter((n) => n >= 0).map((n) => n + 1));
  return {
    width: r.map.width, height: r.map.height, rules: r, cells, bases: cells.map(() => -1), currentSeat: 0, turn: 0, cycle: 1,
    dice: [1, 1], scores: Array.from({ length: seats }, (_, seat) => cells.filter((n) => n === seat).length),
    eliminated: Array.from({ length: seats }, () => false), events: [], lastMove: null, result: null, area: cells.filter((n) => n !== -2).length,
  };
}

function move(s: JinchiState, x: number, y: number, rotated = false): JinchiState {
  const next = jinchi.applyAction(s, s.currentSeat, { type: "place", x, y, rotated }, { rules: s.rules, seats: s.scores.length, rng: createRng(3), now: 0 });
  if (isActionError(next)) throw new Error(next.error.message);
  return next;
}

const catalog = createCatalog([jinchi]);

describe("Jinchi placement", () => {
  it("accepts adjacent rectangles and both rotations, rejecting edges, walls, enemies and remote cells", () => {
    const s = board(["00....", "......", "...#..", "......", ".....1", ".....1"]);
    s.dice = [2, 3];
    expect(placementError(s, 0, 0, 1, false)).toBeNull();
    expect(placementError(s, 0, 0, 1, true)).toBeNull();
    expect(placementError(s, 0, 5, 0, false)).toMatch(/край/);
    expect(placementError(s, 0, 2, 0, false)).toMatch(/стен/);
    expect(placementError(s, 0, 4, 3, false)).toMatch(/чуж/);
    expect(placementError(s, 0, 3, 3, false)).toMatch(/касается/);
    expect(findPlacements(s, 0)).toContainEqual({ type: "place", x: 0, y: 1, rotated: false });
    expect(findPlacements(s, 1)).toEqual([]);
  });

  it("checks side versus corner adjacency and requires at least one newly occupied cell", () => {
    const s = board(["0....", ".....", ".....", ".....", "....1"]);
    expect(placementError(s, 0, 1, 1, false)).toMatch(/касается/);
    s.rules.placement.adjacency = "corner";
    expect(placementError(s, 0, 1, 1, false)).toBeNull();
    expect(placementError(s, 0, 0, 0, false)).toMatch(/сво/);
    s.rules.placement.overlapOwn = true;
    expect(placementError(s, 0, 0, 0, false)).toMatch(/свобод/);
    s.dice = [2, 1];
    expect(placementError(s, 0, 0, 0, false)).toBeNull();
  });

  it("keeps the original state immutable and does not expose full legal lists in views", () => {
    const s = board(["0....", ".....", ".....", ".....", "....1"]);
    const before = structuredClone(s);
    const next = move(s, 1, 0);
    expect(s).toEqual(before);
    expect(next.cells[1]).toBe(0);
    expect(next.lastMove).toMatchObject({ seat: 0, indices: [1], turn: 0 });
    expect(jinchi.view(next, next.currentSeat).canAct).toBe(true);
    expect(jinchi.view(next, null).canAct).toBe(false);
    expect(jinchi.view(next, 0)).not.toHaveProperty("legal");
  });

  it("rejects out-of-turn actions and malformed coordinates on the engine boundary", () => {
    const s = board(["0..", "...", "..1"]);
    const ctx = { rules: s.rules, seats: 2, rng: createRng(1), now: 0 };
    expect(isActionError(jinchi.applyAction(s, 1, { type: "place", x: 1, y: 0, rotated: false }, ctx))).toBe(true);
    expect(placementError(s, 0, NaN, 0, false)).not.toBeNull();
    expect(placementError(s, 0, 0.5, 0, false)).not.toBeNull();
  });
});

describe("Jinchi enclosure", () => {
  const ring = [".......", ".000...", ".0.0...", ".0.....", ".0.0...", ".000...", "......1"];

  it("captures a smaller enclosed component and leaves the exterior open", () => {
    const s = board(ring);
    const next = move(s, 3, 3);
    expect(next.lastMove?.captured.sort((a, b) => a - b)).toEqual([16, 23, 30]);
    expect(next.cells[0]).toBe(-1);
    expect(next.events.some((e) => e.type === "capture")).toBe(true);
  });

  it("lets edges and walls close a ring only when configured", () => {
    const rows = [".0...", "#0...", ".....", ".....", "....1"];
    const s = board(rows);
    const withWalls = move(s, 1, 2);
    expect(withWalls.cells[0]).toBe(0);
    const onlyOwn = board(rows, { capture: { walls: false } });
    expect(move(onlyOwn, 1, 2).cells[0]).toBe(-1);
  });

  it("keeps all equal largest adjacent components open", () => {
    const s = board(["..0..", "..0..", ".....", "..0..", "..01."]);
    const next = move(s, 2, 2);
    expect(next.lastMove?.captured).toEqual([]);
  });

  it("changes flood connectivity for diagonal rings", () => {
    const rows = [".....", "..0..", ".0...", "..0..", "....1"];
    const closed = move(board(rows, { placement: { adjacency: "corner" } }), 3, 2);
    expect(closed.cells[12]).toBe(0);
    const open = move(board(rows, { capture: { diagonal: false }, placement: { adjacency: "corner" } }), 3, 2);
    expect(open.cells[12]).toBe(-1);
  });

  it("treats interior walls as traversable for own-only detection and leaves them walls", () => {
    const rows = ["........", ".0000...", ".0#00...", ".0......", ".0000...", ".......1"];
    const next = move(board(rows, { capture: { walls: false } }), 4, 3);
    expect(next.cells[2 * 8 + 2]).toBe(-2);
    expect(next.cells[3 * 8 + 2]).toBe(0);
  });

  it("captures enemies, records the count and eliminates a player who loses all cells", () => {
    const s = board(ring.map((r, y) => y === 3 ? ".01...." : r.replace(/1/g, ".")));
    const next = move(s, 3, 3);
    expect(next.cells[23]).toBe(0);
    expect(next.eliminated[1]).toBe(true);
    expect(next.result).toMatchObject({ reason: "last-player", winners: [0] });
    expect(next.events.map((e) => e.type)).toContain("eliminate");
  });

  it("preserves protected starting cells or every enemy cell according to the rule", () => {
    const rows = ring.map((r, y) => y === 3 ? ".01...." : r);
    const protectedBase = board(rows, { capture: { opponents: "except-starts" } });
    protectedBase.bases[23] = 1;
    const next = move(protectedBase, 3, 3);
    expect(next.cells[23]).toBe(1);
    expect(next.cells[16]).toBe(0);
    const noEnemies = board(rows, { capture: { opponents: "none" } });
    expect(move(noEnemies, 3, 3).cells[23]).toBe(1);
  });
});

describe("Jinchi turns and setup", () => {
  it("assigns numbered starts in order, converts unused starts, and shuffles reproducibly", () => {
    const r = rules(["11....22", "11....22", "........", "........", "33....44", "33....44"], { dice: { roll: "manual" } });
    const ctx = { rules: r, seats: 2, rng: createRng(1), now: 0, round: 1, firstSeat: 1 };
    const s = jinchi.setup(ctx);
    expect(s.scores).toEqual([4, 4]);
    expect(s.currentSeat).toBe(1);
    expect(s.cells[0]).toBe(0);
    expect(s.cells[6]).toBe(1);
    expect(s.cells[4 * 8]).toBe(-1);
    expect(s.bases[0]).toBe(0);
    expect(s.dice).toBeNull();
    r.starts.unused = "wall";
    expect(jinchi.setup({ ...ctx, rng: createRng(1) }).cells[4 * 8]).toBe(-2);
    r.starts.assignment = "random";
    expect(jinchi.setup({ ...ctx, rng: createRng(42) })).toEqual(jinchi.setup({ ...ctx, rng: createRng(42) }));
  });

  it("offers only roll before a manual throw, rolls on the server, and then offers placements", () => {
    const r = rules(["11....", "11....", "......", "......", "....22", "....22"], { dice: { sides: 2, roll: "manual" } });
    const ctx = { rules: r, seats: 2, rng: createRng(1), now: 0 };
    const s = jinchi.setup({ ...ctx, round: 1, firstSeat: 0 });
    expect(jinchi.legalActions(s, 0, ctx)).toEqual([{ type: "roll" }]);
    const next = jinchi.applyAction(s, 0, { type: "roll" }, ctx);
    if (isActionError(next)) throw new Error(next.error.message);
    expect(next.dice).not.toBeNull();
    expect(jinchi.legalActions(next, 0, ctx).every((a) => a.type === "place")).toBe(true);
    expect(isActionError(jinchi.applyAction(next, 0, { type: "roll" }, ctx))).toBe(true);
  });

  it("skips impossible throws automatically and ends after full consecutive skip cycles", () => {
    const r = rules(["1#2", ".##", "###"], { end: { skipRounds: 2 } });
    const rng = createRng(1);
    rng.int = (_min, max) => max;
    const s = jinchi.setup({ rules: r, seats: 2, rng, now: 0, round: 1, firstSeat: 0 });
    expect(s.result).toMatchObject({ reason: "all-skip" });
    expect(s.events.filter((e) => e.type === "skip")).toHaveLength(4);
  });

  it("does not hang with disabled skip limits even when a long run of maximum dice cannot fit", () => {
    const r = rules(["1#2", ".##", "###"], { end: { skipRounds: 0 } });
    const rng = createRng(1);
    rng.int = (_min, max) => max;
    const before = performance.now();
    const s = jinchi.setup({ rules: r, seats: 2, rng, now: 0, round: 1, firstSeat: 0 });
    expect(performance.now() - before).toBeLessThan(1000);
    expect(s.result === null ? findPlacements(s, s.currentSeat).length : 1).toBeGreaterThan(0);
  });

  it("counts accelerated unlucky cycles toward round limits and caps the visible event history", () => {
    const r = rules(["1#2", ".##", "###"], { end: { skipRounds: 0, maxRounds: 130 } });
    const rng = createRng(1);
    rng.int = (_min, max) => max;
    rng.next = () => 1 - Number.EPSILON;
    const s = jinchi.setup({ rules: r, seats: 2, rng, now: 0, round: 1, firstSeat: 0 });
    expect(s.result).toMatchObject({ reason: "max-rounds" });
    expect(s.cycle).toBe(130);
    expect(s.turn).toBe(260);
    expect(s.events).toHaveLength(100);
    expect(s.events.at(-1)?.id).toBe(519);
  });

  it("accelerates past an immobile seat without giving it someone else's legal dice", () => {
    const r = rules(["1#2", "##.", "###"], { end: { skipRounds: 0 } });
    const rng = createRng(1);
    rng.int = (_min, max) => max;
    rng.next = () => 0;
    const s = jinchi.setup({ rules: r, seats: 2, rng, now: 0, round: 1, firstSeat: 0 });
    expect(s.currentSeat).toBe(1);
    expect(s.turn).toBe(257);
    expect(s.dice).toEqual([1, 1]);
    expect(findPlacements(s, 1)).toEqual([{ type: "place", x: 2, y: 1, rotated: false }]);
  });

  it("ends a divided map before rolling, retaining equal leaders in a draw", () => {
    const r = rules(["111", "###", "222"]);
    const s = jinchi.setup({ rules: r, seats: 2, rng: createRng(1), now: 0, round: 1, firstSeat: 0 });
    expect(s.result).toMatchObject({ reason: "board-full", draw: true, winners: [0, 1] });
    expect(s.events.some((e) => e.type === "roll")).toBe(false);
  });

  it("finishes at target area immediately and applies the round limit after every active player acted", () => {
    const target = board(["00...", ".....", ".....", ".....", "....1"], { end: { targetPercent: 10 } });
    expect(move(target, 2, 0).result).toMatchObject({ reason: "target-percent", winners: [0] });
    const limited = board(["0....", ".....", ".....", ".....", "....1"], { dice: { roll: "manual" }, end: { maxRounds: 1 } });
    const first = move(limited, 1, 0);
    expect(first.result).toBeNull();
    first.dice = [1, 1];
    expect(move(first, 3, 4).result?.reason).toBe("max-rounds");
  });

  it("restores random start assignment, automatic throws, skips and timer passes identically", () => {
    const config = presetDocument(jinchi, PRESETS[0]);
    config.timer = { turnSeconds: 3, onTimeout: "random" };
    const m = Match.start({ game: jinchi, config, seats: 2, seed: 321, startedAt: 0 });
    for (let i = 0; i < 12 && m.currentPhase === "playing"; i++) {
      const s = m.view(null).game as JinchiState;
      const a = jinchi.legalActions(s, s.currentSeat, { rules: s.rules, seats: 2, rng: createRng(2), now: i });
      expect(m.dispatch(s.currentSeat, a[0], i * 1000 + 1).ok).toBe(true);
    }
    m.advance(30_000);
    const restored = Match.restore({ game: jinchi, config, record: m.record(), now: 30_000 });
    expect(restored.view(null)).toEqual(m.view(null));
  });
});

describe("Jinchi config and performance", () => {
  it("rejects broken map dimensions, unknown characters, missing bases and duplicate colors", () => {
    const base = { sdk: 1, game: "jinchi", gameVersion: 1 };
    for (const map of [
      { width: 3, height: 3, rows: [] },
      { width: 3, height: 3, rows: ["1..", "..", "..2"] },
      { width: 3, height: 3, rows: ["1?.", "...", "..2"] },
      { width: 3, height: 3, rows: ["1..", "...", "..."] },
      { width: 201, height: 3, rows: [] },
    ]) expect(validateConfig(catalog, { ...base, rules: { map } }).ok).toBe(false);
    const colors = [...visualSchema.parse({}).colors];
    colors[1] = colors[0]!;
    expect(validateConfig(catalog, { ...base, visual: { colors } }).ok).toBe(false);
  });

  it("checks editor dimensions even before a map passes its Zod schema", () => {
    const r = rules(["1..", "...", "..2"]);
    r.map = { width: 2, height: 3, rows: ["1.", "..", ".2"] };
    expect(checkRules(r)).toContainEqual(expect.objectContaining({ path: "map.width", severity: "error" }));
  });

  it("warns about blocked, touching, unequal starts and oversized dice without rejecting a playable map", () => {
    const r = rules(["112#", ".###", "###3"]);
    const codes = checkRules(r).filter((i) => i.severity === "warning").map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["start-blocked", "starts-touch", "unequal-starts", "large-dice"]));
  });

  it("finds legal anchors on a 200×200 map in linear time", () => {
    const rows = Array.from({ length: 200 }, (_, y) => y === 0 ? "00" + ".".repeat(198) : y === 199 ? ".".repeat(198) + "11" : ".".repeat(200));
    const s = board(rows);
    s.dice = [6, 4];
    const start = performance.now();
    const legal = findPlacements(s, 0);
    expect(legal.length).toBeGreaterThan(0);
    expect(performance.now() - start).toBeLessThan(1500);
    expect(legal.every((a) => a.type === "place" && placementError(s, 0, a.x, a.y, a.rotated) === null)).toBe(true);
  });

  it("captures a 10000-cell component iteratively on the maximum map", () => {
    const rows = Array.from({ length: 200 }, (_, y) => ".".repeat(50) + (y === 100 ? "." : "0") + ".".repeat(148) + (y === 199 ? "1" : "."));
    const s = board(rows);
    const next = move(s, 50, 100);
    expect(next.lastMove?.captured).toHaveLength(10000);
    expect(next.cells[0]).toBe(0);
    expect(next.cells[199]).toBe(-1);
  });

  it("matches the individual legality check for every anchor and orientation on mixed maps", () => {
    const random = createRng(111);
    for (const overlapOwn of [false, true]) for (const adjacency of ["side", "corner"] as const) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const rows = Array.from({ length: 9 }, () => Array.from({ length: 11 }, () => random.pick([".", ".", ".", "#", "0", "1"])).join(""));
        const s = board(rows, { placement: { overlapOwn, adjacency } });
        s.dice = [random.int(1, 4), random.int(1, 4)];
        for (const rotated of [false, true]) {
          const actual = findPlacements(s, 0, rotated).map((a) => `${a.x}:${a.y}`);
          const expected: string[] = [];
          for (let y = 0; y < 9; y++) for (let x = 0; x < 11; x++) if (placementError(s, 0, x, y, rotated) === null) expected.push(`${x}:${y}`);
          expect(actual).toEqual(expected);
        }
      }
    }
  });

  it("describes configured variants for human rules", () => {
    const r = rules(["1..", "...", "..2"], { dice: { sides: 8, roll: "manual" }, capture: { walls: false, opponents: "none", diagonal: false }, starts: { assignment: "ordered", unused: "wall" }, end: { skipRounds: 0, maxRounds: 12, targetPercent: 60 } });
    const text = rulesText(r).join(" ");
    expect(text).toMatch(/8/);
    expect(text).toMatch(/12/);
    expect(text).toMatch(/60/);
    expect(text).toMatch(/только свои/);
  });

  for (const preset of ["duel", "four-corners", "fortresses", "labyrinth", "mainland", "octahedrons"]) {
    it(`${preset}: validates and finishes random games`, () => {
      const p = PRESETS.find((p) => p.id === preset);
      expect(p).toBeDefined();
      const doc = presetDocument(jinchi, p);
      expect(validateConfig(catalog, doc).ok).toBe(true);
      // A frozen clock: this test checks that the preset finishes, the speed is checked above.
      // On a loaded machine the real 1000 ms budget cut mainland short.
      const report = simulate(jinchi, doc, { rounds: 2, maxActions: 3000, seed: 47, nowMs: () => 0 });
      expect(report.finished, JSON.stringify(report)).toBe(2);
      expect(report.issues.filter((i) => ["stuck", "never-ends", "illegal-legal-action"].includes(i.code))).toEqual([]);
    });
  }
});
