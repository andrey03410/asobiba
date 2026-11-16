import { describe, expect, it } from "vitest";
import { defineGame } from "./game";
import { presetDocument } from "./config";
import { Match } from "./match";
import { simulate } from "./simulate";
import { raceGame } from "./testing";

const cannotEnumerate = () => { throw new Error("A large move space must not be enumerated"); };
const efficient = defineGame({
  ...raceGame,
  hasLegalAction: (state, seat) => state.winner === null && state.turn === seat,
  sampleAction: (state, seat, ctx) => state.winner === null && state.turn === seat ? { add: ctx.rng.pick([1, 2] as const) } : null,
  legalActions: cannotEnumerate,
});

describe("optional move-space hooks", () => {
  it("uses the existence hook at setup and after a player move", () => {
    const config = presetDocument(efficient);
    const match = Match.start({ game: efficient, config, seats: 2, seed: 1, startedAt: 0 });
    expect(match.view(0).phase).toBe("playing");
    expect(match.dispatch(0, { add: 2 }, 1)).toEqual({ ok: true });
    expect(match.view(1).game).toMatchObject({ total: 2, turn: 1 });
  });

  it("honors an empty existence hook even when enumeration would claim a move", () => {
    const empty = defineGame({ ...raceGame, hasLegalAction: () => false });
    const match = Match.start({ game: empty, config: presetDocument(empty), seats: 2, seed: 1, startedAt: 0 });
    expect(match.view(null).lastRound?.reason).toBe("no-moves");
  });

  it("samples random timeout actions and restores the same random history", () => {
    const config = presetDocument(efficient);
    config.timer = { turnSeconds: 3, onTimeout: "random" };
    const match = Match.start({ game: efficient, config, seats: 2, seed: 57, startedAt: 0 });
    match.advance(3000);
    expect(match.view(null).game).toMatchObject({ moves: 1, turn: 1 });
    expect((match.view(null).game as { total: number }).total).toBeGreaterThan(0);
    const restored = Match.restore({ game: efficient, config, record: match.record(), now: 3000 });
    expect(restored.view(0)).toEqual(match.view(0));
  });

  it("simulates using samples and finds a playable actor after an empty sample", () => {
    const concurrent = defineGame({ ...efficient, currentSeats: (state) => [1 - state.turn, state.turn] });
    const report = simulate(concurrent, presetDocument(concurrent), { rounds: 2, seed: 7 });
    expect(report.finished).toBe(2);
    expect(report.issues).toEqual([]);
    expect(simulate(concurrent, presetDocument(concurrent), { rounds: 2, seed: 7 })).toEqual(report);
  });

  it("uses null sample as no move and keeps pass and wake behavior", () => {
    const waiting = defineGame({ ...efficient, sampleAction: () => null, passTurn: undefined, nextWakeAt: () => 10, wake: (state) => ({ ...state, winner: 0 }) });
    const report = simulate(waiting, presetDocument(waiting), { rounds: 1 });
    expect(report.finished).toBe(1);
    expect(report.issues).toEqual([]);
  });
});
