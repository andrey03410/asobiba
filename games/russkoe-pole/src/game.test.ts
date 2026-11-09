import { createCatalog, presetDocument, simulate, validateConfig } from "@asobiba/sdk";
import { describe, expect, it } from "vitest";
import { RUSSKOE_POLE_BANK } from "./bank";
import { useWordBank } from "./bank-slot";
import { layoutCrossword } from "./crossword";
import { type PoleAction, type PoleState, type PoleView, russkoePole } from "./game";
import { letterAllowance, rulesSchema, type PoleRules } from "./rules";

useWordBank(RUSSKOE_POLE_BANK);

const catalog = createCatalog([russkoePole]);

function rules(patch: unknown): PoleRules {
  const parsed = rulesSchema.parse(patch);
  const issues = russkoePole.checkRules?.(parsed) ?? [];
  const errors = issues.filter((issue) => issue.severity !== "warning");
  if (errors.length > 0) throw new Error(JSON.stringify(errors));
  return parsed;
}

function play(patch: unknown, seats: number, actions: { seat: number; action: PoleAction }[], seed = 1): PoleState {
  const parsed = rules(patch);
  let state = russkoePole.setup({ rules: parsed, seats, rng: rngOf(seed), round: 1, firstSeat: 0, now: 1_000 });
  for (const step of actions) {
    const next = russkoePole.applyAction(state, step.seat, step.action, { rules: parsed, seats, rng: rngOf(seed + state.turnNo + 3), now: 2_000 + state.turnNo });
    if ("error" in next) throw new Error(`${next.error.code}: ${next.error.message}`);
    state = next;
  }
  return state;
}

function rngOf(seed: number) {
  let value = seed >>> 0;
  const next = () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    state: () => value,
    restore(state: number) {
      value = state >>> 0;
    },
    pick<T>(items: readonly T[]): T {
      return items[int(0, items.length - 1)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    },
  };
}

const quiet = {
  scoring: { lives: 0, wordBonus: 100, miss: "pass", wrongWord: "eliminate" },
  chests: { enabled: false },
  super: { enabled: false },
  timers: { maxSpins: 10, turnSeconds: 0 },
  words: { source: "custom", rounds: 1, custom: [{ question: "Кто мурлычет", answer: "КОТ" }] },
  wheel: [
    { type: "points", value: 100 },
    { type: "points", value: 100 },
    { type: "points", value: 100 },
    { type: "points", value: 100 },
  ],
};

describe("rules and crossword", () => {
  it("rejects a word outside the alphabet and a crossword without a shared letter", () => {
    const badWord = rulesSchema.parse({ words: { source: "custom", rounds: 1, custom: [{ question: "Латиница", answer: "CAT" }] }, alphabet: { sets: ["ru"] } });
    expect(russkoePole.checkRules?.(badWord).some((issue) => issue.code === "unguessable")).toBe(true);
    const badCross = rulesSchema.parse({
      super: { source: "custom", puzzles: [{ words: [{ question: "А", answer: "КОТ" }, { question: "Б", answer: "ПЁС" }] }] },
    });
    expect(russkoePole.checkRules?.(badCross).some((issue) => issue.code === "no_cross")).toBe(true);
    expect(layoutCrossword([{ question: "А", answer: "КОРОНА" }, { question: "Б", answer: "РОЗА" }, { question: "В", answer: "НОТА" }])).not.toBeNull();
  });

  it("caps super-game letters", () => {
    const parsed = rulesSchema.parse({});
    expect(letterAllowance(0, parsed, 10)).toBe(2);
    expect(letterAllowance(100_000, parsed, 10)).toBeLessThanOrEqual(4);
  });

  it("accepts every preset", () => {
    for (const preset of russkoePole.presets) {
      const res = validateConfig(catalog, presetDocument(russkoePole, preset));
      expect(res.ok, JSON.stringify(res.ok ? "" : res.issues)).toBe(true);
    }
  });
});

describe("a word round", () => {
  it("scores a letter, then the whole word, and hides the answer until it is open", () => {
    const spun = play(quiet, 1, [{ seat: 0, action: { type: "spin" } }]);
    expect(spun.phase).toBe("guess");
    const view = russkoePole.view(spun, 0) as PoleView;
    expect(JSON.stringify(view)).not.toContain("КОТ");
    expect(view.tiles.every((tile) => tile.ch === "")).toBe(true);
    const hit = play(quiet, 1, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "letter", letter: "к" } },
    ]);
    expect(hit.players[0]?.round).toBe(100);
    expect(russkoePole.view(hit, null).tiles.map((tile) => tile.ch).join("")).toBe("К");
    const won = play(quiet, 1, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "solve", text: "кот" } },
    ]);
    expect(won.result?.winners).toEqual([0]);
    expect(won.players[0]?.total).toBe(100);
  });

  it("passes the turn on a miss and eliminates a wrong word", () => {
    const missed = play(quiet, 2, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "letter", letter: "я" } },
    ]);
    expect(missed.turn).toBe(1);
    expect(missed.phase).toBe("spin");
    const eliminated = play(quiet, 2, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "solve", text: "пёс" } },
    ]);
    expect(eliminated.players[0]?.outRound).toBe(true);
    expect(eliminated.turn).toBe(1);
  });

  it("clears the round score on bankrupt and ends a solo round when lives run out", () => {
    const bankrupt = play(
      {
        ...quiet,
        scoring: { lives: 0, startingScore: 800, wordBonus: 0 },
        wheel: [
          { type: "bankrupt", loss: "all" },
          { type: "bankrupt", loss: "all" },
          { type: "bankrupt", loss: "all" },
          { type: "bankrupt", loss: "all" },
        ],
      },
      1,
      [{ seat: 0, action: { type: "spin" } }],
    );
    expect(bankrupt.players[0]?.total).toBe(0);
    const dead = play(
      { ...quiet, scoring: { lives: 1, wordBonus: 0 }, wheel: [{ type: "points", value: 100 }, { type: "points", value: 100 }, { type: "points", value: 100 }, { type: "points", value: 100 }] },
      1,
      [
        { seat: 0, action: { type: "spin" } },
        { seat: 0, action: { type: "letter", letter: "я" } },
      ],
    );
    expect(dead.tiles.every((tile) => tile.open)).toBe(true);
    expect(dead.result).not.toBeNull();
  });

  it("opens the word when spins run out", () => {
    const chance = { type: "chance" as const, amount: 10 };
    let state = play({ ...quiet, timers: { maxSpins: 5 }, wheel: [chance, chance, chance, chance] }, 1, []);
    const parsed = rules({ ...quiet, timers: { maxSpins: 5 }, wheel: [chance, chance, chance, chance] });
    for (let i = 0; i < 6 && !state.result; i++) {
      const next = russkoePole.applyAction(state, 0, { type: "spin" }, { rules: parsed, seats: 1, rng: rngOf(10 + i), now: 3000 + i });
      if ("error" in next) throw new Error(next.error.message);
      state = next;
    }
    expect(state.tiles.every((tile) => tile.open)).toBe(true);
  });
});

describe("special sectors", () => {
  it("pays a certain roulette and removes the player who loads every chamber", () => {
    const sector = { type: "roulette" as const, bulletValue: 100, capacity: 2, consequence: "eliminate-round" as const, hostChance: 0 };
    const survived = play({ ...quiet, wheel: [sector, sector, sector, sector] }, 2, [{ seat: 0, action: { type: "spin" } }, { seat: 0, action: { type: "roulette", bullets: 1 } }]);
    expect(survived.players[0]?.round === 100 || survived.players[0]?.outRound).toBe(true);
    const dead = play({ ...quiet, wheel: [sector, sector, sector, sector] }, 2, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "roulette", bullets: 2 } },
    ]);
    expect(dead.players[0]?.outRound).toBe(true);
    expect(dead.turn).toBe(1);
  });

  it("solves a math sector from the hidden value and steals a share", () => {
    const mathWheel = [{ type: "math" as const, ops: ["add" as const], min: 2, max: 2, seconds: 10, maxMultiplier: 2, penalty: 50 }, { type: "math" as const, ops: ["add" as const], min: 2, max: 2, seconds: 10, maxMultiplier: 2, penalty: 50 }, { type: "math" as const, min: 2, max: 2 }, { type: "math" as const, min: 2, max: 2 }];
    const posed = play({ ...quiet, scoring: { lives: 0, wordBonus: 0, startingScore: 0 }, wheel: mathWheel }, 1, [{ seat: 0, action: { type: "spin" } }]);
    expect(posed.math?.text).toBe("2 + 2");
    expect(JSON.stringify(russkoePole.view(posed, 0))).not.toContain('"value"');
    const solved = play({ ...quiet, scoring: { lives: 0, wordBonus: 0 }, wheel: mathWheel }, 1, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "math", value: 4 } },
    ]);
    expect(solved.players[0]?.round).toBeGreaterThan(0);
    const robbed = play(
      {
        ...quiet,
        scoring: { lives: 0, startingScore: 1000, wordBonus: 0 },
        wheel: [
          { type: "steal", share: 0.5 },
          { type: "steal", share: 0.5 },
          { type: "steal", share: 0.5 },
          { type: "steal", share: 0.5 },
        ],
      },
      2,
      [
        { seat: 0, action: { type: "spin" } },
        { seat: 0, action: { type: "target", seat: 1 } },
      ],
    );
    expect(robbed.players[0]?.total).toBe(1500);
    expect(robbed.players[1]?.total).toBe(500);
  });
});

describe("super game", () => {
  const puzzle = {
    source: "custom" as const,
    mode: "solo" as const,
    canDecline: false,
    puzzles: [{ words: [{ question: "Украшение", answer: "КОРОНА" }, { question: "Цветок", answer: "РОЗА" }, { question: "Знак", answer: "НОТА" }] }],
    letters: { base: 2, firstThreshold: 1000, capRatio: 0.4 },
    modifiers: { prizeWheel: false, hints: "none" as const },
  };

  it("opens chosen letters for the solo player and pays the main word", () => {
    const state = play(
      { ...quiet, super: { enabled: true, ...puzzle }, scoring: { lives: 0, wordBonus: 0 } },
      1,
      [
        { seat: 0, action: { type: "spin" } },
        { seat: 0, action: { type: "solve", text: "кот" } },
        { seat: 0, action: { type: "letters", letters: ["к", "о"] } },
      ],
    );
    expect(state.phase).toBe("answer");
    const spectator = russkoePole.view(state, null);
    expect(JSON.stringify(spectator)).not.toContain("РОЗА");
    expect(spectator.cells.some((cell) => cell.ch === "К")).toBe(true);
    const won = play(
      { ...quiet, super: { enabled: true, ...puzzle }, scoring: { lives: 0, wordBonus: 200 } },
      1,
      [
        { seat: 0, action: { type: "spin" } },
        { seat: 0, action: { type: "solve", text: "кот" } },
        { seat: 0, action: { type: "letters", letters: ["к"] } },
        { seat: 0, action: { type: "solve", text: "корона, роза" } },
      ],
    );
    expect(won.result?.winners).toEqual([0]);
    expect(won.players[0]?.total).toBe((200) * 2 + 500);
  });

  it("lets the first correct claim take a skhvatka word the other seat cannot see in advance", () => {
    const sk = { ...puzzle, mode: "skhvatka" as const, sabotage: { enabled: false } };
    const ready = play(
      { ...quiet, scoring: { lives: 0, wordBonus: 0, startingScore: 100 }, super: { enabled: true, ...sk }, players: { min: 1, max: 2 } },
      2,
      [
        { seat: 0, action: { type: "spin" } },
        { seat: 0, action: { type: "solve", text: "кот" } },
        { seat: 0, action: { type: "letters", letters: ["к"] } },
        { seat: 1, action: { type: "letters", letters: ["р"] } },
      ],
    );
    expect(ready.phase).toBe("race");
    const other = russkoePole.view(ready, 1);
    expect(other.yours).toEqual(["р"]);
    expect(JSON.stringify(other.cells)).not.toContain("К");
    const claimed = play(
      { ...quiet, scoring: { lives: 0, wordBonus: 0, startingScore: 100 }, super: { enabled: true, ...sk } },
      2,
      [
        { seat: 0, action: { type: "spin" } },
        { seat: 0, action: { type: "solve", text: "кот" } },
        { seat: 0, action: { type: "letters", letters: ["к"] } },
        { seat: 1, action: { type: "letters", letters: ["р"] } },
        { seat: 1, action: { type: "claim", word: 0, text: "корона" } },
      ],
    );
    expect(claimed.words[0]?.owner).toBe(1);
    expect(claimed.players[1]?.total).toBe(100 + 1000);
    expect(russkoePole.view(claimed, 0).cells.some((cell) => cell.ch === "К")).toBe(true);
  });
});

describe("simulation and secrets", () => {
  it("hides custom answers in the lobby copy", () => {
    const parsed = rules(quiet);
    const shown = russkoePole.presentRules?.(parsed);
    expect(JSON.stringify(shown)).not.toContain("КОТ");
    expect(shown?.words.custom[0]?.answer).toBe("секрет");
  });

  it("finishes random matches without getting stuck", () => {
    const preset = russkoePole.presets.find((item) => item.id === "solo");
    const config = presetDocument(russkoePole, preset);
    const report = simulate(russkoePole, config, { rounds: 3, seed: 4, maxActions: 400 });
    const blocking = report.issues.filter((issue) => issue.code === "stuck" || issue.code === "never-ends" || issue.code === "illegal-legal-action");
    expect(blocking, JSON.stringify(report)).toEqual([]);
    expect(report.finished).toBeGreaterThan(0);
  });
});

describe("acceptance fixes", () => {
  const twoWords = { ...quiet, words: { source: "custom", rounds: 2, custom: [{ question: "Кто мурлычет", answer: "КОТ" }, { question: "Кто лает", answer: "ПЁС" }] } };

  it("plays every preset on a full table to the end", () => {
    for (const preset of russkoePole.presets) {
      const config = presetDocument(russkoePole, preset);
      const report = simulate(russkoePole, config, { rounds: 4, seed: 7, maxActions: 600 });
      const blocking = report.issues.filter((issue) => issue.code === "stuck" || issue.code === "never-ends" || issue.code === "illegal-legal-action");
      expect(blocking, `${preset.id}: ${JSON.stringify(blocking)}`).toEqual([]);
    }
  });

  it("owns its timeout so a silent player never plays a random answer", () => {
    expect(russkoePole.timeoutPolicy).toBe("skip");
  });

  it("hands the turn clockwise past a player who just left the round", () => {
    const state = play({ ...quiet, players: { min: 1, max: 4 } }, 4, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "letter", letter: "я" } },
      { seat: 1, action: { type: "spin" } },
      { seat: 1, action: { type: "letter", letter: "я" } },
      { seat: 2, action: { type: "spin" } },
      { seat: 2, action: { type: "solve", text: "пёс" } },
    ]);
    expect(state.players[2]?.outRound).toBe(true);
    expect(state.turn).toBe(3);
  });

  it("restores lives on a new word and keeps everybody's round points", () => {
    const lives = play({ ...twoWords, scoring: { lives: 2, wordBonus: 0 } }, 1, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "letter", letter: "я" } },
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "letter", letter: "ю" } },
    ]);
    expect(lives.wordIndex).toBe(1);
    expect(lives.players[0]?.lives).toBe(2);
    const banked = play({ ...quiet, scoring: { lives: 0, wordBonus: 100 }, players: { min: 1, max: 2 } }, 2, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "letter", letter: "к" } },
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "letter", letter: "я" } },
      { seat: 1, action: { type: "spin" } },
      { seat: 1, action: { type: "solve", text: "кот" } },
    ]);
    expect(banked.players[0]?.total).toBe(100);
    expect(banked.players[1]?.total).toBe(100);
  });

  it("shows the played word to everybody and opens the crossword at the end", () => {
    const next = play(twoWords, 1, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "solve", text: "кот" } },
    ]);
    const view = russkoePole.view(next, null);
    expect(view.reveal?.answer).toBe("КОТ");
    expect(view.events.some((event) => event.text.includes("КОТ"))).toBe(true);
    expect(JSON.stringify(view.tiles)).not.toContain("П");
  });

  it("applies the sector first and then its `then`", () => {
    const zeroAgain = { type: "zero" as const, penalty: 0, then: "again" as const };
    const again = play({ ...quiet, players: { min: 1, max: 2 }, wheel: [zeroAgain, zeroAgain, zeroAgain, zeroAgain] }, 2, [{ seat: 0, action: { type: "spin" } }]);
    expect(again.turn).toBe(0);
    expect(again.phase).toBe("spin");
    const chancePass = { type: "chance" as const, amount: 50, then: "pass" as const };
    const passed = play({ ...quiet, players: { min: 1, max: 2 }, wheel: [chancePass, chancePass, chancePass, chancePass] }, 2, [{ seat: 0, action: { type: "spin" } }]);
    expect(passed.players[0]?.round).toBe(50);
    expect(passed.turn).toBe(1);
    const prizeGuess = { type: "prize" as const, min: 10, max: 10, then: "guess" as const };
    const guess = play({ ...quiet, wheel: [prizeGuess, prizeGuess, prizeGuess, prizeGuess] }, 1, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "prize", choice: "cash" } },
    ]);
    expect(guess.phase).toBe("guess");
    expect(guess.players[0]?.round).toBe(10);
  });

  it("keeps the spin for everybody and gives its animation to the turn clock", () => {
    const spun = play({ ...quiet, timers: { maxSpins: 10, turnSeconds: 20 } }, 1, [{ seat: 0, action: { type: "spin" } }]);
    const extra = Math.ceil((spun.spin?.durationMs ?? 0) / 1000);
    expect(russkoePole.turnBudgetSeconds?.(spun)).toBe(20 + extra);
    const guessed = play(quiet, 1, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "letter", letter: "к" } },
    ]);
    expect(guessed.spin).not.toBeNull();
    const mathWheel = Array.from({ length: 4 }, () => ({ type: "math" as const, min: 2, max: 2 }));
    const posed = play({ ...quiet, wheel: mathWheel }, 1, [{ seat: 0, action: { type: "spin" } }]);
    expect(posed.math?.startedAt).toBe((posed.spin?.startedAt ?? 0) + (posed.spin?.durationMs ?? 0));
  });

  it("refuses losing at zero without starting points and warns about unused own words", () => {
    const zero = rulesSchema.parse({ scoring: { loseAtZero: true, startingScore: 0 } });
    expect(russkoePole.checkRules?.(zero).some((issue) => issue.code === "instant_out" && issue.severity !== "warning")).toBe(true);
    const ignored = rulesSchema.parse({ words: { source: "bank", custom: [{ question: "А", answer: "КОТ" }] } });
    expect(russkoePole.checkRules?.(ignored).some((issue) => issue.code === "custom_ignored")).toBe(true);
  });

  it("treats a letter opened by Plus as already called", () => {
    const plus = { type: "plus" as const, then: "again" as const };
    const points = { type: "points" as const, value: 100 };
    let state = play({ ...quiet, scoring: { lives: 3, wordBonus: 0 }, wheel: [plus, plus, plus, plus] }, 1, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "plus", index: 0 } },
    ]);
    expect(state.called).toContain("к");
    const parsed = rules({ ...quiet, scoring: { lives: 3, wordBonus: 0 }, wheel: [points, points, points, points] });
    state = { ...state, phase: "guess", sector: 0 };
    const next = russkoePole.applyAction(state, 0, { type: "letter", letter: "к" }, { rules: parsed, seats: 1, rng: rngOf(3), now: 5_000 });
    if ("error" in next) throw new Error(next.error.message);
    expect(next.players[0]?.lives).toBe(3);
  });

  it("ends a solo match with no winner when the player is out", () => {
    const deadly = { type: "roulette" as const, bulletValue: 0, capacity: 2, consequence: "lose-match" as const, hostChance: 0 };
    const state = play({ ...quiet, wheel: [deadly, deadly, deadly, deadly] }, 1, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "roulette", bullets: 2 } },
    ]);
    expect(state.result?.winners).toEqual([]);
    expect(state.tiles.every((tile) => tile.open)).toBe(true);
  });

  it("never pays a math multiplier above the sector maximum, even for an answer given during the spin", () => {
    const math = Array.from({ length: 4 }, () => ({ type: "math" as const, min: 2, max: 2, maxMultiplier: 3 }));
    const parsed = rules({ ...quiet, wheel: math });
    const posed = play({ ...quiet, wheel: math }, 1, [{ seat: 0, action: { type: "spin" } }]);
    const early = russkoePole.applyAction(posed, 0, { type: "math", value: posed.math?.value ?? 0 }, { rules: parsed, seats: 1, rng: rngOf(4), now: 2_100 });
    if ("error" in early) throw new Error(early.error.message);
    expect(early.players[0]?.round).toBe(300);
  });

  it("lets Plus follow an explicit `then` and starts a word without winner clockwise", () => {
    const plusPass = { type: "plus" as const, then: "pass" as const };
    const passed = play({ ...quiet, players: { min: 1, max: 2 }, wheel: [plusPass, plusPass, plusPass, plusPass] }, 2, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "plus", index: 0 } },
    ]);
    expect(passed.turn).toBe(1);
    const three = { ...quiet, players: { min: 1, max: 3 }, scoring: { lives: 0, wordBonus: 0, wrongWord: "eliminate" }, words: { source: "custom", rounds: 2, custom: [{ question: "Кто мурлычет", answer: "КОТ" }, { question: "Кто лает", answer: "ПЁС" }] } };
    const next = play(three, 3, [
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "letter", letter: "я" } },
      { seat: 1, action: { type: "spin" } },
      { seat: 1, action: { type: "solve", text: "пёс" } },
      { seat: 2, action: { type: "spin" } },
      { seat: 2, action: { type: "solve", text: "пёс" } },
      { seat: 0, action: { type: "spin" } },
      { seat: 0, action: { type: "solve", text: "пёс" } },
    ]);
    expect(next.wordIndex).toBe(1);
    expect(next.turn).toBe(1);
  });

  describe("super game", () => {
    const puzzle = {
      source: "custom" as const,
      mode: "solo" as const,
      canDecline: false,
      puzzles: [{ words: [{ question: "Украшение", answer: "КОРОНА" }, { question: "Цветок", answer: "РОЗА" }, { question: "Знак", answer: "НОТА" }] }],
      letters: { base: 2, firstThreshold: 1000, capRatio: 0.4 },
      modifiers: { prizeWheel: false, hints: "none" as const },
    };
    const toSuper = [
      { seat: 0, action: { type: "spin" } as PoleAction },
      { seat: 0, action: { type: "solve", text: "кот" } as PoleAction },
    ];

    it("opens letters one by one, gives extra attempts and opens everything on a loss", () => {
      const one = play({ ...quiet, scoring: { lives: 0, wordBonus: 0 }, super: { enabled: true, ...puzzle, attempts: 2, letters: { ...puzzle.letters, oneByOne: true } } }, 1, [
        ...toSuper,
        { seat: 0, action: { type: "letters", letters: ["к"] } },
      ]);
      expect(one.phase).toBe("letters");
      expect(one.lettersLeft[0]).toBe(1);
      expect(russkoePole.view(one, 0).cells.some((cell) => cell.ch === "К")).toBe(true);
      const answering = play({ ...quiet, scoring: { lives: 0, wordBonus: 0 }, super: { enabled: true, ...puzzle, attempts: 2, letters: { ...puzzle.letters, oneByOne: true } } }, 1, [
        ...toSuper,
        { seat: 0, action: { type: "letters", letters: ["к"] } },
        { seat: 0, action: { type: "letters", letters: ["р"] } },
        { seat: 0, action: { type: "solve", text: "корова" } },
      ]);
      expect(answering.phase).toBe("answer");
      expect(answering.attemptsLeft).toBe(1);
      const stopped = play({ ...quiet, scoring: { lives: 0, wordBonus: 0 }, super: { enabled: true, ...puzzle, letters: { ...puzzle.letters, oneByOne: true } } }, 1, [
        ...toSuper,
        { seat: 0, action: { type: "letters", letters: ["к"] } },
        { seat: 0, action: { type: "letters", letters: [] } },
      ]);
      expect(stopped.phase).toBe("answer");
      const legal = russkoePole.legalActions(one, 0, { rules: rules({ ...quiet, super: { enabled: true, ...puzzle, letters: { ...puzzle.letters, oneByOne: true } } }), seats: 1 } as never);
      for (const action of legal) {
        const out = russkoePole.applyAction(one, 0, action, { rules: rules({ ...quiet, super: { enabled: true, ...puzzle, letters: { ...puzzle.letters, oneByOne: true } } }), seats: 1, rng: rngOf(1), now: 9_000 });
        expect("error" in out ? out.error : null).toBeNull();
      }
      const lost = play({ ...quiet, scoring: { lives: 0, wordBonus: 0 }, super: { enabled: true, ...puzzle } }, 1, [
        ...toSuper,
        { seat: 0, action: { type: "letters", letters: ["к"] } },
        { seat: 0, action: { type: "solve", text: "корова" } },
      ]);
      expect(lost.result).not.toBeNull();
      expect(russkoePole.view(lost, null).cells.every((cell) => cell.open)).toBe(true);
    });

    it("takes one answer per word, in its place", () => {
      const base = { ...quiet, scoring: { lives: 0, wordBonus: 0 }, super: { enabled: true, ...puzzle } };
      const variants = play(base, 1, [...toSuper, { seat: 0, action: { type: "letters", letters: ["к"] } }, { seat: 0, action: { type: "solve", text: "роза, корона" } }]);
      expect(variants.events.some((event) => event.text.startsWith("Суперигра взята"))).toBe(false);
      const listed = play(base, 1, [...toSuper, { seat: 0, action: { type: "letters", letters: ["к"] } }, { seat: 0, action: { type: "answer", answers: ["корова, корона"] } }]);
      expect(listed.events.some((event) => event.text.startsWith("Суперигра взята"))).toBe(false);
      const ready = play(base, 1, [...toSuper, { seat: 0, action: { type: "letters", letters: ["к"] } }]);
      const [answer] = russkoePole.legalActions(ready, 0, { rules: rules(base), seats: 1 } as never);
      expect(answer?.type).toBe("answer");
      const won = russkoePole.applyAction(ready, 0, answer as PoleAction, { rules: rules(base), seats: 1, rng: rngOf(2), now: 9_000 });
      if ("error" in won) throw new Error(won.error.message);
      expect(won.events.some((event) => event.text === "Суперигра взята, бонусных слов: 2")).toBe(true);
    });

    it("draws the prize wheel when its spin times out", () => {
      const base = { ...quiet, scoring: { lives: 0, wordBonus: 0 }, super: { enabled: true, ...puzzle, modifiers: { ...puzzle.modifiers, prizeWheel: true, wheel: [4, 4] } } };
      const atWheel = play(base, 1, toSuper);
      expect(atWheel.phase).toBe("wheel");
      const timedOut = russkoePole.passTurn?.(atWheel, 0, { rules: rules(base), seats: 1, rng: rngOf(5), now: 9_000 });
      expect(timedOut?.prizeMultiplier).toBe(4);
    });

    it("pays exactly the prize wheel multiplier, even ×1", () => {
      const won = play({ ...quiet, scoring: { lives: 0, wordBonus: 1000 }, super: { enabled: true, ...puzzle, modifiers: { ...puzzle.modifiers, prizeWheel: true, wheel: [1, 1] } } }, 1, [
        ...toSuper,
        { seat: 0, action: { type: "spin" } },
        { seat: 0, action: { type: "letters", letters: ["к"] } },
        { seat: 0, action: { type: "solve", text: "корона" } },
      ]);
      expect(won.players[0]?.total).toBe(1000);
    });

    it("runs a skhvatka with sabotage on four seats and charges sabotage only when revealed", () => {
      const sk = { ...puzzle, mode: "skhvatka" as const, finalists: 0, sabotage: { enabled: true, cost: 100 } };
      const base = { ...quiet, players: { min: 1, max: 4 }, scoring: { lives: 0, wordBonus: 0, startingScore: 500 }, super: { enabled: true, ...sk } };
      const chosen = play(base, 4, [
        ...toSuper,
        { seat: 0, action: { type: "letters", letters: ["к"] } },
        { seat: 1, action: { type: "letters", letters: ["р"] } },
        { seat: 2, action: { type: "letters", letters: ["о"] } },
        { seat: 3, action: { type: "letters", letters: ["н"] } },
      ]);
      expect(chosen.phase).toBe("sk-sabotage");
      expect([...russkoePole.currentSeats(chosen)].sort()).toEqual([0, 1, 2, 3]);
      const armed = play(base, 4, [
        ...toSuper,
        { seat: 0, action: { type: "letters", letters: ["к"] } },
        { seat: 1, action: { type: "letters", letters: ["р"] } },
        { seat: 2, action: { type: "letters", letters: ["о"] } },
        { seat: 3, action: { type: "letters", letters: ["н"] } },
        { seat: 3, action: { type: "sabotage", kind: "fog", target: 0 } },
      ]);
      expect(armed.players[3]?.total).toBe(500);
      const race = play(base, 4, [
        ...toSuper,
        { seat: 0, action: { type: "letters", letters: ["к"] } },
        { seat: 1, action: { type: "letters", letters: ["р"] } },
        { seat: 2, action: { type: "letters", letters: ["о"] } },
        { seat: 3, action: { type: "letters", letters: ["н"] } },
        { seat: 3, action: { type: "sabotage", kind: "fog", target: 0 } },
        { seat: 0, action: { type: "sabotage", kind: "none" } },
        { seat: 1, action: { type: "sabotage", kind: "none" } },
        { seat: 2, action: { type: "sabotage", kind: "shield" } },
      ]);
      expect(race.phase).toBe("race");
      expect(race.players[3]?.total).toBe(400);
      expect(race.players[2]?.total).toBe(400);
      expect(race.raceEndsAt).toBeGreaterThan(0);
    });
  });
});
