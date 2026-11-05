import { describe, expect, it } from "vitest";
import { createCatalog, presetDocument, validateConfig } from "./config";
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

const fixedRace = defineGame({ ...raceGame, legalActions: () => [{ add: 1 as const }] });
const budgetRace = defineGame({ ...fixedRace, simulationBudget: () => ({ maxTotalActions: 12 }) });

function issueCodes(report: ReturnType<typeof simulate>) {
  return report.issues.map((issue) => issue.code);
}

describe("simulation computation budget", () => {
  it("applies the game's total budget across finished and partially attempted rounds", () => {
    const report = simulate(budgetRace, cfg("race"), { rounds: 5 });
    expect(report).toMatchObject({ requestedRounds: 5, rounds: 2, skippedRounds: 3, finished: 1, unfinished: 1, averageActions: 6, maxActions: 10 });
    expect(issueCodes(report)).toEqual(["budget-exceeded"]);
    expect(report.finished + report.unfinished).toBe(report.rounds);
  });

  it("lets callers lower a game's budget but never raise it", () => {
    const lower = simulate(budgetRace, cfg("race"), { rounds: 5, maxTotalActions: 3 });
    expect(lower).toMatchObject({ rounds: 1, skippedRounds: 4, finished: 0, unfinished: 1, maxActions: 3 });
    const higher = simulate(budgetRace, cfg("race"), { rounds: 5, maxTotalActions: 100 });
    expect(higher).toMatchObject({ rounds: 2, skippedRounds: 3, finished: 1, unfinished: 1, maxActions: 10 });
    expect(issueCodes(lower)).toEqual(["budget-exceeded"]);
  });

  it("counts an outcome reached by the final allowed global or per-round action", () => {
    const global = simulate(fixedRace, cfg("race"), { rounds: 1, maxTotalActions: 10 });
    expect(global).toMatchObject({ rounds: 1, requestedRounds: 1, skippedRounds: 0, finished: 1, unfinished: 0 });
    expect(global.issues).toEqual([]);
    const perRound = simulate(fixedRace, cfg("race"), { rounds: 1, maxActions: 10 });
    expect(perRound.finished).toBe(1);
    expect(perRound.issues).toEqual([]);
  });

  it("does not start another round when the cap exactly finishes the prior one", () => {
    const report = simulate(fixedRace, cfg("race"), { rounds: 5, maxTotalActions: 20 });
    expect(report).toMatchObject({ requestedRounds: 5, rounds: 2, skippedRounds: 3, finished: 2, unfinished: 0, averageActions: 10 });
    expect(issueCodes(report)).toEqual(["budget-exceeded"]);
  });

  it("reports independent per-round failures without calling a budget-cut round never-ending", () => {
    const report = simulate(endless, cfg("endless"), { rounds: 5, maxActions: 3, maxTotalActions: 7 });
    expect(report).toMatchObject({ requestedRounds: 5, rounds: 3, skippedRounds: 2, finished: 0, unfinished: 3, averageActions: 2.3, maxActions: 3 });
    expect(issueCodes(report)).toEqual(["never-ends", "budget-exceeded"]);
    expect(report.issues.find((issue) => issue.code === "never-ends")?.message).toMatch(/^2 из 3 /);
  });

  it("retains per-round limit failures when no global budget exists", () => {
    const report = simulate(endless, cfg("endless"), { rounds: 4, maxActions: 3 });
    expect(report).toMatchObject({ requestedRounds: 4, rounds: 4, skippedRounds: 0, unfinished: 4, maxActions: 3 });
    expect(issueCodes(report)).toEqual(["never-ends"]);
  });

  it("normalizes finite caller limits to whole actions with a minimum of one", () => {
    for (const maxTotalActions of [0, -4, 0.5, 1.8]) {
      const report = simulate(fixedRace, cfg("race"), { rounds: 2, maxTotalActions });
      expect(report).toMatchObject({ rounds: 1, requestedRounds: 2, skippedRounds: 1, unfinished: 1, maxActions: 1 });
      expect(issueCodes(report)).toEqual(["budget-exceeded"]);
    }
  });

  it("leaves older games unbounded unless a caller supplies a finite limit", () => {
    for (const maxTotalActions of [undefined, Infinity, NaN]) {
      const report = simulate(fixedRace, cfg("race"), { rounds: 4, maxTotalActions });
      expect(report).toMatchObject({ rounds: 4, requestedRounds: 4, skippedRounds: 0, finished: 4, unfinished: 0 });
      expect(report.issues).toEqual([]);
    }
  });

  it("counts realtime ticks and recognizes a result at the budget boundary", () => {
    const realtime = defineGame({
      ...endless,
      kind: "realtime",
      legalActions: () => [],
      tick: (s) => ({ ...s, moves: s.moves + 1 }),
      roundResult: (s) => s.moves >= 2 ? { winners: [0], losers: [1], draw: false, reason: "test" } : null,
      simulationBudget: () => ({ maxTotalActions: 3 }),
    });
    const report = simulate(realtime, cfg("endless"), { rounds: 4 });
    expect(report).toMatchObject({ requestedRounds: 4, rounds: 2, skippedRounds: 2, finished: 1, unfinished: 1, maxActions: 2 });
    expect(issueCodes(report)).toEqual(["budget-exceeded"]);
  });
});


describe("Jinchi simulation budget", () => {
  it("scales the game budget by map area and allows smaller caller limits", async () => {
    const { jinchi } = await import("../../../games/jinchi/src/index");
    const config = presetDocument(jinchi);
    const rules = jinchi.rulesSchema.parse({ map: { width: 200, height: 200, rows: Array.from({ length: 200 }, (_, y) => y === 0 ? "1" + ".".repeat(199) : y === 199 ? ".".repeat(199) + "2" : ".".repeat(200)) }, dice: { sides: 2 } });
    config.rules = rules;
    expect(jinchi.simulationBudget?.(rules)).toEqual({ maxTotalActions: 500 });
    const report = simulate(jinchi, config, { rounds: 100, maxTotalActions: 2 });
    expect(report).toMatchObject({ requestedRounds: 100, rounds: 1, skippedRounds: 99, finished: 0, unfinished: 1, maxActions: 2 });
    expect(issueCodes(report)).toEqual(["budget-exceeded"]);
  });
});
