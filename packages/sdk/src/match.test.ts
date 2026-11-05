import { describe, expect, it } from "vitest";
import { type ConfigDocument, createCatalog, validateConfig } from "./config";
import { INTERMISSION_MS, Match } from "./match";
import { driftGame, raceGame } from "./testing";

const catalog = createCatalog([raceGame, driftGame]);

function config(game: "race" | "drift", patch: Record<string, unknown> = {}): ConfigDocument {
  const res = validateConfig(catalog, { sdk: 1, game, gameVersion: 1, ...patch });
  if (!res.ok) throw new Error(JSON.stringify(res.issues));
  return res.config;
}

const T0 = 1_000_000;

describe("Match: turn game", () => {
  it("rejects a move out of turn and bad actions", () => {
    const m = Match.start({ game: raceGame, config: config("race"), seats: 2, seed: 1, startedAt: T0 });
    expect(m.dispatch(1, { add: 1 }, T0 + 10)).toMatchObject({ ok: false, error: { code: "not_your_turn" } });
    expect(m.dispatch(0, { add: 3 }, T0 + 10)).toMatchObject({ ok: false, error: { code: "bad_action" } });
    expect(m.dispatch(0, { add: 2 }, T0 + 10)).toEqual({ ok: true });
    expect(m.view(null).currentSeats).toEqual([1]);
  });

  it("plays a series with a pause between rounds and rotates the first seat", () => {
    const m = Match.start({
      game: raceGame,
      config: config("race", { rules: { target: 2 }, series: { rounds: 3, stopWhenDecided: false } }),
      seats: 2,
      seed: 1,
      startedAt: T0,
    });
    expect(m.dispatch(0, { add: 2 }, T0 + 1)).toEqual({ ok: true });
    const v1 = m.view(0);
    expect(v1.phase).toBe("intermission");
    expect(v1.scores).toEqual([1, 0]);
    expect(m.dispatch(1, { add: 2 }, T0 + 2)).toMatchObject({ ok: false, error: { code: "intermission" } });
    expect(m.nextWakeAt()).toBe(T0 + 1 + INTERMISSION_MS);

    m.advance(T0 + 1 + INTERMISSION_MS);
    const v2 = m.view(0);
    expect(v2.phase).toBe("playing");
    expect(v2.round).toBe(2);
    expect(v2.currentSeats).toEqual([1]);

    expect(m.dispatch(1, { add: 2 }, T0 + 5000)).toEqual({ ok: true });
    m.advance(T0 + 5000 + INTERMISSION_MS);
    expect(m.dispatch(0, { add: 2 }, T0 + 9000)).toEqual({ ok: true });
    const end = m.view(null);
    expect(end.phase).toBe("finished");
    expect(end.result).toEqual({ winners: [0], draw: false, scores: [2, 1] });
  });

  it("stops the series early when the leader cannot be caught", () => {
    const m = Match.start({ game: raceGame, config: config("race", { rules: { target: 2 }, series: { rounds: 3 } }), seats: 2, seed: 1, startedAt: T0 });
    m.dispatch(0, { add: 2 }, T0 + 1);
    m.advance(T0 + 1 + INTERMISSION_MS);
    // round 2: seat 1 starts and passes the turn by adding 1, seat 0 wins
    m.dispatch(1, { add: 1 }, T0 + 4000);
    m.dispatch(0, { add: 1 }, T0 + 4001);
    expect(m.view(null).result).toEqual({ winners: [0], draw: false, scores: [2, 0] });
  });

  it("applies the timer policies", () => {
    const skip = Match.start({ game: raceGame, config: config("race", { timer: { turnSeconds: 5, onTimeout: "skip" } }), seats: 2, seed: 1, startedAt: T0 });
    expect(skip.nextWakeAt()).toBe(T0 + 5000);
    skip.advance(T0 + 5000);
    expect(skip.view(null).currentSeats).toEqual([1]);
    expect(skip.view(null).game).toMatchObject({ total: 0 });
    expect(skip.view(null).turnDeadline).toBe(T0 + 10_000);

    const random = Match.start({ game: raceGame, config: config("race", { timer: { turnSeconds: 5, onTimeout: "random" } }), seats: 2, seed: 1, startedAt: T0 });
    random.advance(T0 + 5000);
    const g = random.view(null).game as { total: number };
    expect(g.total).toBeGreaterThan(0);

    const lose = Match.start({ game: raceGame, config: config("race", { timer: { turnSeconds: 5, onTimeout: "lose" } }), seats: 2, seed: 1, startedAt: T0 });
    lose.advance(T0 + 5000);
    expect(lose.view(null).result).toEqual({ winners: [1], draw: false, scores: [0, 1] });
    expect(lose.view(null).lastRound?.reason).toBe("timeout");
  });

  it("restores exactly the same state from the record", () => {
    const cfg = config("race", { rules: { target: 7 }, series: { rounds: 5, stopWhenDecided: false }, timer: { turnSeconds: 3, onTimeout: "random" } });
    const m = Match.start({ game: raceGame, config: cfg, seats: 2, seed: 99, startedAt: T0 });
    let t = T0;
    for (let i = 0; i < 12; i++) {
      t += 1000 + i * 700; // some moves are late and trigger random timeouts
      const seat = m.view(null).currentSeats[0];
      if (seat !== undefined) m.dispatch(seat, { add: (i % 2) + 1 }, t);
      else m.advance(t);
    }
    const now = t + 20_000;
    m.advance(now);
    const restored = Match.restore({ game: raceGame, config: cfg, record: m.record(), now });
    expect(restored.view(0)).toEqual(m.view(0));
    expect(restored.record()).toEqual(m.record());
  });
});

describe("Match: realtime game", () => {
  it("runs fixed ticks and finishes the round", () => {
    const m = Match.start({ game: driftGame, config: config("drift", { rules: { length: 10 } }), seats: 2, seed: 1, startedAt: T0 });
    expect(m.nextWakeAt()).toBe(T0 + 100);
    m.dispatch(0, { speed: 5 }, T0 + 1);
    m.dispatch(1, { speed: 3 }, T0 + 2);
    m.advance(T0 + 150);
    expect((m.view(null).game as { positions: number[] }).positions).toEqual([5, 3]);
    m.advance(T0 + 1000);
    expect(m.view(null).result?.winners).toEqual([0]);
    expect(m.nextWakeAt()).toBeNull();
  });

  it("replays realtime matches deterministically", () => {
    const cfg = config("drift", { rules: { length: 50 }, series: { rounds: 2, stopWhenDecided: false } });
    const m = Match.start({ game: driftGame, config: cfg, seats: 2, seed: 3, startedAt: T0 });
    m.dispatch(0, { speed: 2 }, T0 + 30);
    m.dispatch(1, { speed: 4 }, T0 + 470);
    m.dispatch(0, { speed: 5 }, T0 + 900);
    const now = T0 + 60_000;
    m.advance(now);
    const restored = Match.restore({ game: driftGame, config: cfg, record: m.record(), now });
    expect(restored.view(null)).toEqual(m.view(null));
  });
});
