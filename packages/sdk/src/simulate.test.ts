import { describe, expect, it } from "vitest";
import { createCatalog, validateConfig } from "./config";
import { defineGame } from "./game";
import { simulate } from "./simulate";
import { raceGame } from "./testing";

const endless = defineGame({
  ...raceGame,
  id: "endless",
  applyAction: (s, _seat, action, ctx) => ({ ...s, total: (s.total + action.add) % 5, moves: s.moves + 1, turn: (s.turn + 1) % ctx.seats }),
  roundResult: () => null,
});
const catalog = createCatalog([raceGame, endless]);

function cfg(game: string) {
  const res = validateConfig(catalog, { sdk: 1, game, gameVersion: 1 });
  if (!res.ok) throw new Error("invalid");
  return res.config;
}

describe("simulate", () => {
  it("plays every round of a healthy game to the end", () => {
    const report = simulate(raceGame, cfg("race"), { rounds: 40 });
    expect(report.finished).toBe(40);
    expect(report.unfinished).toBe(0);
    expect(report.winsBySeat.reduce((a, b) => a + b, 0)).toBe(40);
    expect(report.issues.filter((i) => i.code === "never-ends")).toEqual([]);
  });

  it("reports rounds that never end", () => {
    const report = simulate(endless, cfg("endless"), { rounds: 5, maxActions: 50 });
    expect(report.finished).toBe(0);
    expect(report.issues.map((i) => i.code)).toContain("never-ends");
  });

  it("is deterministic for a seed", () => {
    expect(simulate(raceGame, cfg("race"), { seed: 5 })).toEqual(simulate(raceGame, cfg("race"), { seed: 5 }));
  });
});
