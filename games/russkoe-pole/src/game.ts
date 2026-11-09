import { actionError, defineGame, type RoundResult, type Seat } from "@asobiba/sdk";
import { z } from "zod";
import { alphabetChars, alphabetSet, canonChar, canonText, isVowel } from "./alphabet";
import { getWordBank, type BankWord } from "./bank-slot";
import { crosswordCells, distinctLetters, layoutCrossword, type LayoutCell, type PlacedWord } from "./crossword";
import { POLE_GUIDE } from "./guide";
import { PRESETS } from "./presets";
import { presentRules } from "./present";
import { checkRules, letterAllowance, rulesSchema, sectorLabel, type PoleRules, type Sector } from "./rules";
import { checkVisual, resolveVisual, THEMES, VISUAL_CATALOG, visualSchema, type PoleVisual } from "./visual";

export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("spin") }),
  z.strictObject({ type: z.literal("skip-spin") }),
  z.strictObject({ type: z.literal("letter"), letter: z.string().trim().min(1).max(4) }),
  z.strictObject({ type: z.literal("solve"), text: z.string().trim().min(1).max(80) }),
  z.strictObject({ type: z.literal("plus"), index: z.int().min(0).max(59) }),
  z.strictObject({ type: z.literal("prize"), choice: z.enum(["cash", "box"]) }),
  z.strictObject({ type: z.literal("detector"), buy: z.boolean() }),
  z.strictObject({ type: z.literal("roulette"), bullets: z.int().min(1).max(8) }),
  z.strictObject({ type: z.literal("math"), value: z.number().min(-100000).max(100000) }),
  z.strictObject({ type: z.literal("target"), seat: z.int().min(0).max(4) }),
  z.strictObject({ type: z.literal("chest"), index: z.int().min(0).max(5) }),
  z.strictObject({ type: z.literal("super"), accept: z.boolean() }),
  z.strictObject({ type: z.literal("letters"), letters: z.array(z.string().trim().min(1).max(4)).max(20) }),
  z.strictObject({ type: z.literal("buy-letter") }),
  z.strictObject({
    type: z.literal("sabotage"),
    kind: z.enum(["none", "freeze", "fog", "peek", "shield"]),
    target: z.int().min(0).max(4).optional(),
  }),
  z.strictObject({ type: z.literal("claim"), word: z.int().min(0).max(5), text: z.string().trim().min(1).max(60) }),
]);
export type PoleAction = z.output<typeof actionSchema>;

export interface Tile {
  ch: string;
  open: boolean;
}

export interface Player {
  total: number;
  round: number;
  lives: number;
  out: boolean;
  outRound: boolean;
  words: number;
  luck: boolean;
  correct: number;
  pausedUntil: number;
  note: string;
  peeks: number[];
}

export interface SpinInfo {
  sector: number;
  durationMs: number;
  startedAt: number;
  skipped: boolean;
}

export interface PoleEvent {
  id: number;
  text: string;
  seat: number | null;
  secret: boolean;
}

export type Phase =
  | "spin"
  | "guess"
  | "plus"
  | "prize"
  | "detector"
  | "roulette"
  | "math"
  | "steal"
  | "swap"
  | "chests"
  | "offer"
  | "wheel"
  | "letters"
  | "answer"
  | "sk-letters"
  | "sk-sabotage"
  | "race"
  | "done";

export interface PoleState {
  phase: Phase;
  seats: number;
  turn: number;
  turnNo: number;
  wordIndex: number;
  wordCount: number;
  question: string;
  answer: string;
  tiles: Tile[];
  called: string[];
  streakSeat: number;
  streak: number;
  spins: number;
  passes: number;
  players: Player[];
  spin: SpinInfo | null;
  sector: number | null;
  math: { text: string; value: number; startedAt: number; seconds: number } | null;
  chestGood: number | null;
  chestCount: number;
  alphabet: string[];
  yoAsYe: boolean;
  showCalled: boolean;
  clock: { turn: number; letters: number; answer: number; race: number };
  maxSpins: number;
  livesMax: number;
  superOn: boolean;
  hardcore: boolean;
  lastSolver: number | null;
  finalists: number[];
  lettersLeft: number[];
  chosen: (string[] | null)[];
  sabotage: ({ kind: "none" | "freeze" | "fog" | "peek" | "shield"; target: number } | null)[];
  sabotageOpen: boolean;
  words: PuzzleWord[];
  cells: LayoutCell[];
  openKeys: string[];
  prizeMultiplier: number;
  wheelSpun: boolean;
  raceEndsAt: number;
  events: PoleEvent[];
  eventSeq: number;
  result: RoundResult | null;
}

export interface PoleView {
  phase: Phase;
  you: number | null;
  turn: number;
  wordIndex: number;
  wordCount: number;
  question: string;
  tiles: { ch: string; open: boolean }[];
  called: string[];
  alphabet: string[];
  showCalled: boolean;
  players: {
    total: number;
    round: number;
    lives: number;
    out: boolean;
    outRound: boolean;
    words: number;
    pausedUntil: number;
    note: string;
  }[];
  spin: SpinInfo | null;
  sector: number | null;
  math: { text: string; seconds: number; startedAt: number } | null;
  chests: number | null;
  finalists: number[];
  lettersLeft: number;
  yours: string[];
  peeked: { seat: number; letters: string[] }[];
  words: { question: string; dir: "h" | "v"; row: number; col: number; main: boolean; price: number; owner: number | null; length: number }[];
  cells: { key: string; row: number; col: number; ch: string; open: boolean; words: number[] }[];
  raceEndsAt: number;
  events: { id: number; text: string; seat: number | null }[];
  result: RoundResult | null;
}

const SUPER: ReadonlySet<Phase> = new Set(["offer", "wheel", "letters", "answer", "sk-letters", "sk-sabotage", "race"]);

interface PuzzleWord extends PlacedWord {
  price: number;
  owner: number | null;
}

function say(state: PoleState, text: string, seat: number | null = null, secret = false): PoleState {
  const event: PoleEvent = { id: state.eventSeq + 1, text, seat, secret };
  return { ...state, eventSeq: event.id, events: [...state.events, event].slice(-40) };
}

function patch(state: PoleState, seat: number, change: (player: Player) => Player): PoleState {
  return { ...state, players: state.players.map((player, index) => (index === seat ? change(player) : player)) };
}

function alive(state: PoleState): number[] {
  return state.players.flatMap((player, index) => (player.out ? [] : [index]));
}

function inRound(state: PoleState): number[] {
  return alive(state).filter((index) => !state.players[index]?.outRound);
}

function nextSeat(state: PoleState, from: number): number {
  const pool = inRound(state);
  if (pool.length === 0) return from;
  const at = pool.indexOf(from);
  return pool[(at + 1) % pool.length] ?? from;
}

function zeroOut(state: PoleState, rules: PoleRules): PoleState {
  if (!rules.scoring.loseAtZero) return state;
  return {
    ...state,
    players: state.players.map((player) => (player.out || player.total + player.round > 0 ? player : { ...player, out: true, outRound: true })),
  };
}

function makeTiles(answer: string, rules: PoleRules): Tile[] {
  const letters = alphabetSet(rules.alphabet);
  return [...answer].map((ch) => {
    const known = letters.has(canonChar(ch, rules.alphabet.yoAsYe));
    return { ch, open: !known && rules.alphabet.revealNonAlphabet };
  });
}

function wordOf(rules: PoleRules, index: number, rng: { pick<T>(items: readonly T[]): T }): BankWord {
  const custom = rules.words.custom;
  if (rules.words.source !== "bank" && index < custom.length) {
    const word = custom[index]!;
    return { question: word.question, answer: word.answer.trim().toLocaleUpperCase("ru-RU") };
  }
  if (rules.words.source === "custom") {
    const word = custom[custom.length - 1];
    return { question: word?.question ?? "Задание", answer: (word?.answer ?? "СЛОВО").trim().toLocaleUpperCase("ru-RU") };
  }
  const pool = getWordBank()
    .themes.filter((theme) => (rules.words.themes as readonly string[]).includes(theme.id))
    .flatMap((theme) => theme.words);
  if (pool.length === 0) return { question: "Слово откроется в партии", answer: "ПОЛЕ" };
  const picked = rng.pick(pool);
  return { question: picked.question, answer: picked.answer.toLocaleUpperCase("ru-RU") };
}

function withWord(state: PoleState, rules: PoleRules, index: number, turn: number, rng: { pick<T>(items: readonly T[]): T }): PoleState {
  const word = wordOf(rules, index, rng);
  return {
    ...state,
    phase: "spin",
    wordIndex: index,
    question: word.question,
    answer: word.answer,
    tiles: makeTiles(word.answer, rules),
    called: [],
    streak: 0,
    streakSeat: -1,
    spins: 0,
    passes: 0,
    spin: null,
    sector: null,
    math: null,
    chestGood: null,
    turn,
    turnNo: state.turnNo + 1,
    players: state.players.map((player) => ({ ...player, round: 0, outRound: player.out, correct: 0, note: "" })),
  };
}

function done(state: PoleState): boolean {
  return state.tiles.every((tile) => tile.open);
}

function openLetter(tiles: Tile[], letter: string, yo: boolean): Tile[] {
  const key = canonChar(letter, yo);
  return tiles.map((tile) => (canonChar(tile.ch, yo) === key ? { ...tile, open: true } : tile));
}

function sameAnswer(guess: string, answer: string, yo: boolean): boolean {
  return canonText(guess, yo) === canonText(answer, yo);
}

function bank(player: Player, bonus: number): Player {
  return { ...player, total: player.total + player.round + bonus, round: 0, words: player.words + 1 };
}

function finishMatch(state: PoleState): PoleState {
  const pool = alive(state).length > 0 ? alive(state) : state.players.map((_, index) => index);
  const best = Math.max(...pool.map((index) => state.players[index]?.total ?? 0));
  const winners = pool.filter((index) => state.players[index]?.total === best);
  const draw = winners.length !== 1;
  const result: RoundResult = {
    winners,
    losers: pool.filter((index) => !winners.includes(index)),
    draw,
    reason: "points",
    summary: draw ? "поровну очков" : "больше очков",
  };
  return { ...state, phase: "done", result, spin: null, turnNo: state.turnNo + 1 };
}

function endWord(state: PoleState, winner: number | null, rules: PoleRules, rng: { pick<T>(items: readonly T[]): T; int(min: number, max: number): number; shuffle<T>(items: readonly T[]): T[] }): PoleState {
  let next = state;
  if (winner !== null) next = patch(next, winner, (player) => bank(player, rules.scoring.wordBonus));
  next = { ...next, tiles: next.tiles.map((tile) => ({ ...tile, open: true })), lastSolver: winner ?? next.lastSolver };
  next = zeroOut(next, rules);
  if (rules.scoring.eliminateLast) {
    const active = alive(next);
    if (active.length >= 2) {
      const worst = Math.min(...active.map((index) => next.players[index]?.total ?? 0));
      const tied = active.filter((index) => next.players[index]?.total === worst);
      const loser = rng.pick(tied);
      next = patch(say(next, "Последнее место выбывает", loser), loser, (player) => ({ ...player, out: true }));
    }
  }
  if (alive(next).length === 0) return finishMatch(next);
  if (next.wordIndex + 1 < next.wordCount) {
    const starter = winner !== null && !next.players[winner]?.out ? winner : (alive(next)[0] ?? 0);
    return say(withWord(next, rules, next.wordIndex + 1, starter, rng), winner === null ? "Слово открыто, раунд без победителя" : "Слово угадано");
  }
  return beginSuper(say(next, winner === null ? "Слово открыто" : "Слово угадано"), rules, rng);
}

function puzzleWords(rules: PoleRules, rng: { pick<T>(items: readonly T[]): T }): BankWord[] {
  if (rules.super.source === "custom" && rules.super.puzzles.length > 0) return rng.pick(rules.super.puzzles).words;
  const puzzles = getWordBank().puzzles;
  return (puzzles.length > 0 ? rng.pick(puzzles) : { words: [{ question: "Слово для превью", answer: "ПОЛЕ" }] }).words;
}

function beginSuper(state: PoleState, rules: PoleRules, rng: { pick<T>(items: readonly T[]): T; int(min: number, max: number): number; shuffle<T>(items: readonly T[]): T[] }): PoleState {
  if (!state.superOn) return finishMatch(state);
  const active = alive(state);
  const mode = rules.super.mode === "solo" || active.length < 2 ? "solo" : rules.super.mode === "skhvatka" || rules.super.mode === "auto" ? "skhvatka" : "solo";
  if (mode === "solo") {
    let pool = active;
    if (rules.super.who === "leader") {
      const best = Math.max(...active.map((index) => state.players[index]?.total ?? 0));
      pool = active.filter((index) => state.players[index]?.total === best);
    } else if (rules.super.who === "most-words") {
      const best = Math.max(...active.map((index) => state.players[index]?.words ?? 0));
      pool = active.filter((index) => state.players[index]?.words === best);
    } else if (state.lastSolver !== null && active.includes(state.lastSolver)) pool = [state.lastSolver];
    const seat = pool.length === 0 ? null : rng.pick(pool);
    if (seat === null || (state.players[seat]?.total ?? 0) < rules.super.minScore) return finishMatch(say(state, "До суперигры не хватило очков"));
    const opened = openPuzzle(state, rules, rng, [seat]);
    if (rules.super.canDecline) return { ...opened, phase: "offer", turn: seat, turnNo: state.turnNo + 1 };
    return enterLetters(opened, rules, rng);
  }
  const ranked = [...active].sort((a, b) => (state.players[b]?.total ?? 0) - (state.players[a]?.total ?? 0) || (state.players[b]?.words ?? 0) - (state.players[a]?.words ?? 0));
  const eligible = ranked.filter((index) => (state.players[index]?.total ?? 0) >= rules.super.minScore);
  const want = rules.super.finalists <= 0 ? eligible.length : Math.min(rules.super.finalists, eligible.length);
  if (want < 2) {
    const only = eligible[0];
    if (only === undefined) return finishMatch(say(state, "До суперигры не хватило очков"));
    const opened = openPuzzle(state, rules, rng, [only]);
    return rules.super.canDecline ? { ...opened, phase: "offer", turn: only, turnNo: state.turnNo + 1 } : enterLetters(opened, rules, rng);
  }
  const cut = eligible[want - 1]!;
  const score = state.players[cut]?.total ?? 0;
  const words = state.players[cut]?.words ?? 0;
  const above = eligible.filter((index) => (state.players[index]?.total ?? 0) > score || ((state.players[index]?.total ?? 0) === score && (state.players[index]?.words ?? 0) > words));
  const tied = eligible.filter((index) => state.players[index]?.total === score && state.players[index]?.words === words);
  const finalists = [...above, ...rng.shuffle(tied).slice(0, want - above.length)];
  const opened = openPuzzle(state, rules, rng, finalists);
  return enterLetters({ ...opened, phase: "sk-letters" }, rules, rng);
}

function openPuzzle(state: PoleState, rules: PoleRules, rng: { pick<T>(items: readonly T[]): T; int(min: number, max: number): number; shuffle<T>(items: readonly T[]): T[] }, finalists: number[]): PoleState {
  const count = finalists.length >= 2 ? Math.min(6, Math.max(finalists.length + 1, 1)) : Math.min(6, rules.super.puzzles[0]?.words.length || 3);
  const source = puzzleWords(rules, rng).slice(0, finalists.length >= 2 ? Math.min(6, finalists.length + 1) : count);
  const placed = layoutCrossword(source) ?? layoutCrossword([{ question: source[0]?.question ?? "Слово", answer: source[0]?.answer ?? "ПОЛЕ" }]);
  const words: PuzzleWord[] = (placed ?? []).map((word, index) => ({
    ...word,
    price: index === 0 ? rules.super.prices.main : rules.super.prices.other,
    owner: null,
  }));
  const cells = crosswordCells(words);
  const letters = alphabetSet(rules.alphabet);
  const openKeys = cells.filter((cell) => !letters.has(canonChar(cell.ch, rules.alphabet.yoAsYe)) && rules.alphabet.revealNonAlphabet).map((cell) => cell.key);
  let next: PoleState = {
    ...state,
    words,
    cells,
    openKeys,
    finalists,
    prizeMultiplier: 1,
    sabotage: finalists.map(() => null),
    sabotageOpen: false,
    chosen: state.players.map(() => null),
    hardcore: rules.super.modifiers.hardcore,
    lettersLeft: allowanceFor(state, rules, words, finalists),
  };
  if (rules.super.modifiers.hints === "first") {
    for (const word of words) {
      const cell = cells.find((item) => item.words.includes(words.indexOf(word)) && item.ch === word.answer[0]);
      if (cell) next = { ...next, openKeys: [...next.openKeys, cell.key] };
    }
  } else if (rules.super.modifiers.hints === "random" && cells.length > 0) {
    const hidden = cells.filter((cell) => letters.has(canonChar(cell.ch, rules.alphabet.yoAsYe)));
    for (const cell of rng.shuffle(hidden).slice(0, rules.super.modifiers.hintCount)) next = { ...next, openKeys: [...next.openKeys, cell.key] };
  }
  return say(next, "Суперигра");
}

function allowanceFor(state: PoleState, rules: PoleRules, words: PlacedWord[], finalists: number[]): number[] {
  const distinct = distinctLetters(words, (char) => canonChar(char, rules.alphabet.yoAsYe));
  return state.players.map((player, index) => (finalists.includes(index) ? letterAllowance(player.total, rules, distinct) : 0));
}

function enterLetters(state: PoleState, rules: PoleRules, _rng: { int(min: number, max: number): number; pick<T>(items: readonly T[]): T }): PoleState {
  const leader = [...state.finalists].sort((a, b) => (state.players[b]?.total ?? 0) - (state.players[a]?.total ?? 0))[0] ?? state.turn;
  if (rules.super.modifiers.prizeWheel && !state.wheelSpun) return { ...state, phase: "wheel", turn: leader, turnNo: state.turnNo + 1 };
  if (state.finalists.length >= 2) return { ...state, phase: "sk-letters", turn: state.finalists[0] ?? 0, turnNo: state.turnNo + 1 };
  return { ...state, phase: "letters", turn: state.finalists[0] ?? state.turn, turnNo: state.turnNo + 1 };
}

function defaultThen(type: Sector["type"]): "again" | "guess" | "pass" {
  if (type === "points" || type === "multiplier") return "guess";
  if (type === "bankrupt" || type === "zero") return "pass";
  return "again";
}

function opponents(state: PoleState, seat: number): number[] {
  return inRound(state).filter((index) => index !== seat);
}

function handTurn(state: PoleState, rules: PoleRules, rng: { pick<T>(items: readonly T[]): T; int(min: number, max: number): number; shuffle<T>(items: readonly T[]): T[] }, missed: boolean): PoleState {
  let next = missed ? miss(state, rules) : state;
  next = zeroOut(next, rules);
  if (alive(next).length === 0) return finishMatch(next);
  if (inRound(next).length === 0) return endWord(next, null, rules, rng);
  const turn = nextSeat(next, state.turn);
  const passes = next.passes + 1;
  if (passes >= Math.max(3, inRound(next).length * 3)) return endWord({ ...next, passes }, null, rules, rng);
  const solo = inRound(next).length === 1;
  return { ...next, phase: "spin", turn: solo ? (inRound(next)[0] ?? turn) : turn, turnNo: next.turnNo + 1, passes, spin: null, sector: null, math: null };
}

function miss(state: PoleState, rules: PoleRules): PoleState {
  const seat = state.turn;
  return patch(state, seat, (player) => {
    if (rules.scoring.lives <= 0) return player;
    const lives = player.lives - 1;
    return { ...player, lives, outRound: lives <= 0 || player.outRound };
  });
}

function sectorOf(state: PoleState, rules: PoleRules): Sector | null {
  return state.sector === null ? null : (rules.wheel[state.sector] ?? null);
}

function gain(player: Player, amount: number): Player {
  return { ...player, round: player.round + amount };
}

function afterGuess(state: PoleState, rules: PoleRules, seat: number, rng: { int(min: number, max: number): number; pick<T>(items: readonly T[]): T; shuffle<T>(items: readonly T[]): T[] }): PoleState {
  if (done(state)) return endWord(state, seat, rules, rng);
  const streak = state.streakSeat === seat ? state.streak + 1 : 1;
  let next = patch({ ...state, streak, streakSeat: seat, passes: 0 }, seat, (player) => ({ ...player, correct: player.correct + 1 }));
  if (rules.chests.enabled && streak >= rules.chests.streak) {
    return say({ ...next, phase: "chests", chestGood: rng.int(0, rules.chests.count - 1), chestCount: rules.chests.count, turnNo: next.turnNo + 1 }, "Шкатулки");
  }
  return { ...next, phase: "spin", turnNo: next.turnNo + 1, spin: null };
}

function applyPoints(state: PoleState, rules: PoleRules, sector: Sector, letter: string, rng: { int(min: number, max: number): number; pick<T>(items: readonly T[]): T; shuffle<T>(items: readonly T[]): T[] }): PoleState | ReturnType<typeof actionError> {
  const yo = rules.alphabet.yoAsYe;
  const key = canonChar(letter, yo);
  if (!state.alphabet.includes(key)) return actionError("bad_letter", "Такой буквы нет в алфавите");
  const repeated = state.called.includes(key);
  const hits = state.tiles.filter((tile) => !tile.open && canonChar(tile.ch, yo) === key).length;
  if (repeated || hits === 0) {
    let next = say({ ...state, called: repeated ? state.called : [...state.called, key], streak: 0 }, repeated ? "Эта буква уже была" : "Такой буквы нет", state.turn);
    if (repeated && rules.scoring.repeat === "half") {
      next = patch(next, state.turn, (player) => ({ ...player, total: Math.floor(player.total / 2), round: Math.floor(player.round / 2) }));
    } else if (!repeated && sector.type === "points" && rules.scoring.miss === "penalty") {
      next = patch(next, state.turn, (player) => ({ ...player, round: Math.max(0, player.round - sector.value) }));
    } else if (!repeated && sector.type === "multiplier" && sector.miss === "half") {
      next = patch(next, state.turn, (player) => (sector.base === "round" ? { ...player, round: Math.floor(player.round / 2) } : { ...player, total: Math.floor(player.total / 2) }));
    }
    return handTurn(next, rules, rng, !repeated);
  }
  let next = { ...state, tiles: openLetter(state.tiles, letter, yo), called: [...state.called, key] };
  if (sector.type === "points") next = patch(next, state.turn, (player) => gain(player, sector.value * hits));
  if (sector.type === "multiplier") {
    next = patch(next, state.turn, (player) => {
      const base = sector.base === "round" ? player.round : player.total + player.round;
      const factor = 1 + hits * (sector.k - 1);
      const updated = Math.round(base * factor);
      return sector.base === "round" ? { ...player, round: updated } : { ...player, total: updated, round: 0 };
    });
  }
  return say(afterGuess(next, rules, state.turn, rng), `Буква ${key.toLocaleUpperCase("ru-RU")} есть`, state.turn);
}

function land(state: PoleState, rules: PoleRules, index: number, rng: { int(min: number, max: number): number; pick<T>(items: readonly T[]): T; shuffle<T>(items: readonly T[]): T[] }, now: number): PoleState {
  const sector = rules.wheel[index];
  if (!sector) return state;
  const spin: SpinInfo = { sector: index, durationMs: 4000 + rng.int(0, 3000), startedAt: now, skipped: false };
  let next: PoleState = say({ ...state, spin, sector: index, spins: state.spins + 1, passes: 0 }, `Сектор: ${sectorLabel(sector)}`, state.turn);
  const then = sector.then ?? defaultThen(sector.type);
  if (sector.type === "bankrupt") {
    next = patch(next, state.turn, (player) => {
      if (sector.loss === "all") return { ...player, total: 0, round: 0 };
      if (sector.loss === "share") {
        const left = Math.floor((player.total + player.round) * (1 - sector.share));
        return { ...player, total: left, round: 0 };
      }
      return { ...player, round: 0 };
    });
    return handTurn(say(next, "Банкрот", state.turn), rules, rng, false);
  }
  if (sector.type === "zero") {
    next = patch(next, state.turn, (player) => ({ ...player, round: Math.max(0, player.round - sector.penalty) }));
    return handTurn(say(next, "Ноль", state.turn), rules, rng, false);
  }
  if (sector.type === "chance") {
    next = patch(next, state.turn, (player) => gain(player, sector.amount));
    return { ...say(next, `Шанс: +${sector.amount}`, state.turn), phase: "spin", turnNo: next.turnNo + 1 };
  }
  if (sector.type === "hint") {
    const hidden = next.tiles.filter((tile) => !tile.open && alphabetSet(rules.alphabet).has(canonChar(tile.ch, rules.alphabet.yoAsYe)));
    const tile = hidden.length > 0 ? rng.pick(hidden) : null;
    const note = tile ? canonChar(tile.ch, rules.alphabet.yoAsYe).toLocaleUpperCase("ru-RU") : "";
    next = patch(next, state.turn, (player) => ({ ...player, note }));
    return { ...say(next, note ? `В слове есть буква ${note}` : "Подсказывать уже нечего", state.turn, true), phase: "spin", turnNo: next.turnNo + 1 };
  }
  if (then === "pass") return handTurn(next, rules, rng, false);
  if (then === "guess" && (sector.type === "points" || sector.type === "multiplier")) return { ...next, phase: "guess", turnNo: next.turnNo + 1 };
  if (sector.type === "plus") return { ...next, phase: "plus", turnNo: next.turnNo + 1 };
  if (sector.type === "prize") return say({ ...next, phase: "prize", turnNo: next.turnNo + 1 }, "Деньги или чёрный ящик?");
  if (sector.type === "roulette") return say({ ...next, phase: "roulette", turnNo: next.turnNo + 1 }, "Сколько патронов зарядить?");
  if (sector.type === "math") {
    const problem = makeMath(sector, rng);
    return say({ ...next, phase: "math", math: { ...problem, startedAt: now, seconds: sector.seconds }, turnNo: next.turnNo + 1 }, `Пример: ${problem.text}`);
  }
  if (sector.type === "steal" || sector.type === "swap") {
    if (opponents(next, state.turn).length === 0) return { ...next, phase: "spin", turnNo: next.turnNo + 1 };
    return { ...next, phase: sector.type, turnNo: next.turnNo + 1 };
  }
  return { ...next, phase: "spin", turnNo: next.turnNo + 1 };
}

function makeMath(sector: Extract<Sector, { type: "math" }>, rng: { int(min: number, max: number): number; pick<T>(items: readonly T[]): T }): { text: string; value: number } {
  const op = rng.pick(sector.ops);
  let a = rng.int(sector.min, sector.max);
  let b = rng.int(Math.min(sector.min, sector.max), sector.max);
  if (op === "mul") {
    a = rng.int(sector.min, Math.min(sector.max, 12));
    b = rng.int(1, Math.min(sector.max, 12));
  }
  if (op === "sub" && b > a) [a, b] = [b, a];
  const value = op === "add" ? a + b : op === "sub" ? a - b : a * b;
  const sign = op === "add" ? "+" : op === "sub" ? "−" : "×";
  return { text: `${a} ${sign} ${b}`, value };
}

function mustSolve(state: PoleState, rules: PoleRules): boolean {
  return rules.scoring.threeGuesses && inRound(state).length === 1 && (state.players[state.turn]?.correct ?? 0) >= 3;
}

function lettersOf(action: string[], allowance: number, rules: PoleRules): string[] | null {
  const out: string[] = [];
  for (const raw of action) {
    const key = canonChar(raw, rules.alphabet.yoAsYe);
    if (!alphabetSet(rules.alphabet).has(key) || out.includes(key)) continue;
    out.push(key);
    if (out.length >= allowance) break;
  }
  const limit = rules.super.modifiers.vowelLimit;
  if (limit > 0 && out.filter((letter) => isVowel(letter, rules.alphabet.yoAsYe)).length > limit) return null;
  return out;
}

function revealChosen(state: PoleState, seat: number, letters: string[]): PoleState {
  const want = new Set(letters);
  const extra = state.cells.filter((cell) => want.has(canonChar(cell.ch, state.yoAsYe))).map((cell) => cell.key);
  return { ...state, openKeys: [...new Set([...state.openKeys, ...extra])], chosen: state.chosen.map((list, index) => (index === seat ? letters : list)) };
}

function toAnswer(state: PoleState, seat: number): PoleState {
  return { ...state, phase: "answer", turn: seat, turnNo: state.turnNo + 1 };
}

function closeLetters(state: PoleState, rules: PoleRules): PoleState {
  if (state.finalists.length >= 2) {
    const ready = state.finalists.every((seat) => state.chosen[seat]);
    if (!ready) return state;
    return rules.super.sabotage.enabled ? { ...state, phase: "sk-sabotage", turnNo: state.turnNo + 1 } : startRace(state, rules, 0);
  }
  const seat = state.finalists[0] ?? state.turn;
  return toAnswer(revealChosen(state, seat, state.chosen[seat] ?? []), seat);
}

function startRace(state: PoleState, _rules: PoleRules, now: number): PoleState {
  return say({ ...state, phase: "race", sabotageOpen: true, raceEndsAt: now, turnNo: state.turnNo + 1 }, "Схватка началась");
}

function resolveSabotage(state: PoleState, rules: PoleRules, rng: { pick<T>(items: readonly T[]): T; shuffle<T>(items: readonly T[]): T[] }, now: number): PoleState {
  let next = { ...state, sabotageOpen: true };
  const attacks: { from: number; kind: "freeze" | "fog" | "peek"; target: number }[] = [];
  state.finalists.forEach((seat) => {
    const item = state.sabotage[seat];
    if (!item || item.kind === "none" || item.kind === "shield") return;
    attacks.push({ from: seat, kind: item.kind, target: item.target });
  });
  const shielded = new Set(state.finalists.filter((seat) => state.sabotage[seat]?.kind === "shield"));
  for (const attack of attacks) {
    if (shielded.has(attack.target)) {
      shielded.delete(attack.target);
      next = say(next, "Щит отбил пакость", attack.target);
      continue;
    }
    if (attack.kind === "freeze") {
      next = patch(next, attack.target, (player) => ({ ...player, pausedUntil: now + rules.super.sabotage.freezeSeconds * 1000 }));
      next = say(next, "Заморозка", attack.target);
    } else if (attack.kind === "peek") {
      next = patch(next, attack.from, (player) => ({ ...player, peeks: [...player.peeks, attack.target] }));
      next = say(next, "Подглядел буквы", attack.from);
    } else {
      const letters = next.chosen[attack.target] ?? [];
      if (letters.length > 0) {
        const dropped = rng.pick(letters);
        next = { ...next, chosen: next.chosen.map((list, index) => (index === attack.target ? (list ?? []).filter((letter) => letter !== dropped) : list)) };
        next = say(next, "Туман закрыл букву", attack.target);
      }
    }
  }
  return startRace(next, rules, now);
}

function claim(state: PoleState, rules: PoleRules, seat: number, wordIndex: number, now: number): PoleState {
  const word = state.words[wordIndex];
  if (!word || word.owner !== null) return state;
  const keys = state.cells.filter((cell) => cell.words.includes(wordIndex)).map((cell) => cell.key);
  const price = Math.round(word.price * state.prizeMultiplier);
  let next: PoleState = {
    ...state,
    openKeys: [...new Set([...state.openKeys, ...keys])],
    words: state.words.map((item, index) => (index === wordIndex ? { ...item, owner: seat } : item)),
  };
  next = patch(next, seat, (player) => ({ ...player, total: player.total + price }));
  next = say(next, `Слово забрано: +${price}`, seat);
  if (next.words.every((item) => item.owner !== null)) return finishMatch(next);
  return next;
}

function failSuper(state: PoleState, rules: PoleRules, seat: number): PoleState {
  const share = rules.super.stake.loseShare;
  return finishMatch(say(patch(state, seat, (player) => ({ ...player, total: Math.round(player.total * (1 - share)) })), "Суперигра не сдалась", seat));
}

function winSuper(state: PoleState, rules: PoleRules, seat: number, bonusHits: number): PoleState {
  const mult = state.prizeMultiplier > 1 ? state.prizeMultiplier : rules.super.stake.winMultiplier;
  const bonus = bonusHits * rules.super.prices.other;
  return finishMatch(say(patch(state, seat, (player) => ({ ...player, total: Math.round(player.total * mult) + bonus })), "Суперигра взята", seat));
}

function spinOrPass(state: PoleState, rules: PoleRules, rng: { pick<T>(items: readonly T[]): T; int(min: number, max: number): number; shuffle<T>(items: readonly T[]): T[] }): PoleState {
  const sector = sectorOf(state, rules);
  const then = sector?.then ?? "again";
  if (then === "pass") return handTurn(state, rules, rng, false);
  return { ...state, phase: "spin", turnNo: state.turnNo + 1, spin: null };
}

export const russkoePole = defineGame({
  id: "russkoe-pole",
  version: 1,
  title: "Русское поле",
  summary: "Словесная игра с барабаном на 1–5 игроков: раунды, суперигра и Схватка",
  kind: "turn",
  rulesSchema,
  visualSchema,
  actionSchema,
  seats: (rules) => ({ min: rules.players.min, max: rules.players.max }),
  checkRules,
  checkVisual,
  presentRules,
  simulationBudget: () => ({ maxTotalActions: 800, maxDurationMs: 1000 }),
  turnBudgetSeconds: (state: PoleState) => {
    if (state.result) return 0;
    if (state.phase === "math") return state.math?.seconds ?? state.clock.turn;
    if (state.phase === "letters" || state.phase === "sk-letters" || state.phase === "sk-sabotage" || state.phase === "wheel" || state.phase === "offer") return state.clock.letters;
    if (state.phase === "answer") return state.clock.answer;
    if (state.phase === "race") return state.clock.race;
    return state.clock.turn;
  },

  setup: ({ rules, seats, rng, firstSeat }): PoleState => {
    const players: Player[] = Array.from({ length: seats }, () => ({
      total: rules.scoring.startingScore,
      round: 0,
      lives: rules.scoring.lives,
      out: false,
      outRound: false,
      words: 0,
      luck: false,
      correct: 0,
      pausedUntil: 0,
      note: "",
      peeks: [],
    }));
    const blank: PoleState = {
      phase: "spin",
      seats,
      turn: firstSeat,
      turnNo: 0,
      wordIndex: 0,
      wordCount: rules.words.rounds,
      question: "",
      answer: "",
      tiles: [],
      called: [],
      streakSeat: -1,
      streak: 0,
      spins: 0,
      passes: 0,
      players,
      spin: null,
      sector: null,
      math: null,
      chestGood: null,
      chestCount: rules.chests.count,
      alphabet: alphabetChars(rules.alphabet),
      yoAsYe: rules.alphabet.yoAsYe,
      showCalled: rules.showCalled,
      clock: { turn: rules.timers.turnSeconds, letters: rules.super.lettersSeconds, answer: rules.super.answerSeconds, race: rules.super.raceSeconds },
      maxSpins: rules.timers.maxSpins,
      livesMax: rules.scoring.lives,
      superOn: rules.super.enabled,
      hardcore: false,
      lastSolver: null,
      finalists: [],
      lettersLeft: [],
      chosen: [],
      sabotage: [],
      sabotageOpen: false,
      words: [],
      cells: [],
      openKeys: [],
      prizeMultiplier: 1,
      wheelSpun: false,
      raceEndsAt: 0,
      events: [],
      eventSeq: 0,
      result: null,
    };
    return say(withWord(blank, rules, 0, firstSeat, rng), "Партия началась");
  },

  currentSeats: (state: PoleState) => {
    if (state.result || state.phase === "done") return [];
    if (state.phase === "sk-letters") return state.finalists.filter((seat) => state.chosen[seat] === null);
    if (state.phase === "sk-sabotage") return state.finalists.filter((seat) => state.sabotage[seat] === null);
    if (state.phase === "race") return state.finalists.filter((seat) => !state.players[seat]?.out);
    if (SUPER.has(state.phase)) return state.players[state.turn]?.out ? [] : [state.turn];
    return inRound(state).includes(state.turn) ? [state.turn] : inRound(state).slice(0, 1);
  },

  turnId: (state: PoleState) => {
    if (state.phase === "sk-letters" || state.phase === "sk-sabotage" || state.phase === "race") return state.phase;
    return `${state.phase}:${state.turnNo}`;
  },

  legalActions: (state: PoleState, seat, ctx): PoleAction[] => {
    const rules = ctx.rules;
    if (state.result) return [];
    if (state.phase === "spin") return [{ type: "spin" }];
    if (state.phase === "guess") {
      const letters = state.alphabet.filter((letter) => !state.called.includes(letter)).map((letter) => ({ type: "letter" as const, letter }));
      const solve: PoleAction[] = mustSolve(state, rules) ? [] : letters;
      return [...(mustSolve(state, rules) ? [] : solve), { type: "solve", text: state.answer }];
    }
    if (state.phase === "plus") {
      const index = state.tiles.findIndex((tile) => !tile.open);
      return index < 0 ? [{ type: "solve", text: state.answer }] : [{ type: "plus", index }];
    }
    if (state.phase === "prize") return [{ type: "prize", choice: "cash" }, { type: "prize", choice: "box" }];
    if (state.phase === "detector") {
      const sector = sectorOf(state, rules);
      const cost = sector?.type === "prize" ? sector.detectorCost : 0;
      const afford = (state.players[seat]?.total ?? 0) + (state.players[seat]?.round ?? 0) >= cost;
      return afford ? [{ type: "detector", buy: true }, { type: "detector", buy: false }] : [{ type: "detector", buy: false }];
    }
    if (state.phase === "roulette") {
      const sector = sectorOf(state, rules);
      const cap = sector?.type === "roulette" ? sector.capacity : 6;
      return [{ type: "roulette", bullets: 1 }, { type: "roulette", bullets: cap }];
    }
    if (state.phase === "math" && state.math) return [{ type: "math", value: state.math.value }, { type: "math", value: state.math.value + 1 }];
    if (state.phase === "steal" || state.phase === "swap") return opponents(state, seat).map((target) => ({ type: "target", seat: target }));
    if (state.phase === "chests") return [{ type: "chest", index: 0 }, { type: "chest", index: Math.max(0, state.chestCount - 1) }];
    if (state.phase === "offer") return [{ type: "super", accept: true }, { type: "super", accept: false }];
    if (state.phase === "wheel") return [{ type: "spin" }];
    if (state.phase === "letters" || state.phase === "sk-letters") {
      const sample = state.alphabet.slice(0, Math.max(1, state.lettersLeft[seat] ?? 1)).map((letter) => letter);
      const actions: PoleAction[] = [{ type: "letters", letters: sample.length > 0 ? [sample[0]!] : [] }];
      if (rules.super.modifiers.buyLetter && (state.players[seat]?.total ?? 0) >= rules.super.modifiers.buyLetterCost) actions.push({ type: "buy-letter" });
      return actions;
    }
    if (state.phase === "answer") return [{ type: "solve", text: state.words[0]?.answer ?? state.answer }];
    if (state.phase === "sk-sabotage") {
      const target = state.finalists.find((item) => item !== seat) ?? seat;
      const actions: PoleAction[] = [{ type: "sabotage", kind: "none" }];
      if ((state.players[seat]?.total ?? 0) >= rules.super.sabotage.cost) actions.push({ type: "sabotage", kind: "shield", target });
      return actions;
    }
    if (state.phase === "race") {
      return state.words.flatMap((word, index) => (word.owner === null ? [{ type: "claim" as const, word: index, text: word.answer }] : []));
    }
    return [];
  },

  applyAction: (state: PoleState, seat, action: PoleAction, ctx): PoleState | ReturnType<typeof actionError> => {
    const rules = ctx.rules;
    const rng = ctx.rng;
    if (state.result) return actionError("round_over", "Партия окончена");
    if (action.type === "skip-spin") {
      if (!state.spin || state.spin.skipped) return actionError("no_spin", "Барабан сейчас не крутится");
      return { ...state, spin: { ...state.spin, skipped: true } };
    }
    if (state.phase === "spin" && action.type === "spin") {
      if (state.spins >= state.maxSpins) return endWord(say(state, "Вращения кончились"), null, rules, rng);
      return land(state, rules, rng.int(0, rules.wheel.length - 1), rng, ctx.now);
    }
    if (state.phase === "guess" && (action.type === "letter" || action.type === "solve")) {
      if (action.type === "solve" || mustSolve(state, rules)) {
        if (action.type !== "solve") return actionError("must_solve", "Пора называть слово целиком");
        if (sameAnswer(action.text, state.answer, state.yoAsYe)) return endWord(say(state, "Слово названо верно", seat), seat, rules, rng);
        const wrong = rules.scoring.wrongWord;
        let next = say(state, "Слово названо неверно", seat);
        if (wrong === "eliminate") next = patch(next, seat, (player) => ({ ...player, outRound: true }));
        if (wrong === "penalty") next = patch(next, seat, (player) => ({ ...player, round: Math.max(0, player.round - rules.scoring.wrongWordPenalty) }));
        if (wrong === "lose-match") {
          next = patch(next, seat, (player) => ({ ...player, out: true, total: 0, round: 0 }));
          if (alive(next).length <= 1) return finishMatch(next);
        }
        if (wrong === "pass" || wrong === "penalty") return handTurn(next, rules, rng, false);
        return handTurn(next, rules, rng, false);
      }
      const sector = sectorOf(state, rules);
      if (!sector || (sector.type !== "points" && sector.type !== "multiplier")) return actionError("no_sector", "Сначала крутите барабан");
      return applyPoints(state, rules, sector, action.letter, rng);
    }
    if (state.phase === "plus" && action.type === "plus") {
      const tile = state.tiles[action.index];
      if (!tile || tile.open) return actionError("bad_cell", "Эту клетку уже видно");
      const next = { ...state, tiles: openLetter(state.tiles, tile.ch, state.yoAsYe) };
      return afterGuess(say(next, "Плюс открыл букву", seat), rules, seat, rng);
    }
    if (state.phase === "prize" && action.type === "prize") {
      const sector = sectorOf(state, rules);
      if (sector?.type !== "prize") return actionError("no_sector", "Сейчас не приз");
      if (action.choice === "cash") {
        const amount = rng.int(sector.min, Math.max(sector.min, sector.max));
        return spinOrPass(patch(say(state, `В ящике ${amount}`, seat), seat, (player) => gain(player, amount)), rules, rng);
      }
      const event = rng.pick(sector.events);
      return boxEvent(state, rules, sector, event, rng);
    }
    if (state.phase === "detector" && action.type === "detector") {
      const sector = sectorOf(state, rules);
      const cost = sector?.type === "prize" ? sector.detectorCost : 0;
      if (!action.buy) return spinOrPass(say(state, "Детектор не взяли", seat), rules, rng);
      const player = state.players[seat];
      if (!player || player.total + player.round < cost) return actionError("poor", "На детектор не хватает очков");
      const letters = alphabetSet(rules.alphabet);
      const tiles = state.tiles.map((tile) => (letters.has(canonChar(tile.ch, state.yoAsYe)) ? tile : { ...tile, open: true }));
      const paid = patch({ ...state, tiles }, seat, (item) => ({ ...item, total: Math.max(0, item.total - cost) }));
      return spinOrPass(say(paid, "Детектор открыл знаки", seat), rules, rng);
    }
    if (state.phase === "roulette" && action.type === "roulette") {
      const sector = sectorOf(state, rules);
      if (sector?.type !== "roulette") return actionError("no_sector", "Сейчас не рулетка");
      if (action.bullets > sector.capacity) return actionError("too_many", "Столько патронов барабан не возьмёт");
      let next = patch(say(state, `Заряжено патронов: ${action.bullets}`, seat), seat, (player) => gain(player, sector.bulletValue * action.bullets));
      const luck = next.players[seat]?.luck ? 0.5 : 1;
      const dead = rng.int(1, 1000) / 1000 < (action.bullets / sector.capacity) * luck;
      const host = !dead && sector.hostChance > 0 && rng.int(1, 1000) / 1000 < sector.hostChance;
      if (!dead && !host) return spinOrPass(say(next, "Щелчок. Повезло", seat), rules, rng);
      next = say(next, host ? "Не стоит со мной шутить!" : "Выстрел", seat);
      if (sector.consequence === "zero-round") next = patch(next, seat, (player) => ({ ...player, round: 0 }));
      if (sector.consequence === "zero-all") next = patch(next, seat, (player) => ({ ...player, total: 0, round: 0 }));
      if (sector.consequence === "lose-match") {
        next = patch(next, seat, (player) => ({ ...player, out: true, total: 0, round: 0 }));
        if (alive(next).length <= 1) return finishMatch(next);
      }
      if (sector.consequence === "eliminate-round") next = patch(next, seat, (player) => ({ ...player, outRound: true }));
      return handTurn(next, rules, rng, false);
    }
    if (state.phase === "math" && action.type === "math") {
      const sector = sectorOf(state, rules);
      const problem = state.math;
      if (sector?.type !== "math" || !problem) return actionError("no_sector", "Сейчас не пример");
      if (Math.round(action.value) !== problem.value) {
        return spinOrPass(patch(say(state, "Пример не сошёлся", seat), seat, (player) => ({ ...player, round: Math.max(0, player.round - sector.penalty) })), rules, rng);
      }
      const left = Math.max(0, 1 - (ctx.now - problem.startedAt) / (problem.seconds * 1000));
      const mult = 1 + (sector.maxMultiplier - 1) * left;
      return spinOrPass(patch(say(state, "Пример решён", seat), seat, (player) => ({ ...player, round: Math.round((player.round > 0 ? player.round : 100) * mult) })), rules, rng);
    }
    if ((state.phase === "steal" || state.phase === "swap") && action.type === "target") {
      if (!opponents(state, seat).includes(action.seat)) return actionError("bad_target", "Этого игрока сейчас нельзя выбрать");
      const sector = sectorOf(state, rules);
      if (state.phase === "swap") {
        const mine = state.players[seat]?.round ?? 0;
        const theirs = state.players[action.seat]?.round ?? 0;
        let next = patch(state, seat, (player) => ({ ...player, round: theirs }));
        next = patch(next, action.seat, (player) => ({ ...player, round: mine }));
        return spinOrPass(say(next, "Очки раунда обменены", seat), rules, rng);
      }
      const share = sector?.type === "steal" ? sector.share : 0.25;
      const victim = state.players[action.seat];
      const taken = Math.floor((victim?.total ?? 0) * share);
      let next = patch(state, action.seat, (player) => ({ ...player, total: player.total - taken }));
      next = patch(next, seat, (player) => ({ ...player, total: player.total + taken }));
      return spinOrPass(say(next, `Кража: ${taken}`, seat), rules, rng);
    }
    if (state.phase === "chests" && action.type === "chest") {
      if (action.index >= state.chestCount) return actionError("bad_chest", "Нет такой шкатулки");
      const hit = action.index === state.chestGood;
      const next = patch(say(state, hit ? "В шкатулке приз" : "Шкатулка пустая", seat), seat, (player) => ({
        ...player,
        round: hit ? player.round + rules.chests.prize : Math.max(0, player.round - rules.chests.penalty),
      }));
      return { ...next, phase: "spin", chestGood: null, turnNo: next.turnNo + 1, streak: 0 };
    }
    if (state.phase === "offer" && action.type === "super") {
      if (!action.accept) return finishMatch(say(state, "От суперигры отказались", seat));
      return enterLetters(state, rules, rng);
    }
    if (state.phase === "wheel" && action.type === "spin") {
      const values = rules.super.modifiers.wheel;
      const value = rng.pick(values);
      return enterLetters(say({ ...state, prizeMultiplier: value, wheelSpun: true }, `Суперприз ×${value}`, seat), rules, rng);
    }
    if ((state.phase === "letters" || state.phase === "sk-letters") && action.type === "buy-letter") {
      if (!rules.super.modifiers.buyLetter) return actionError("no_shop", "Покупка букв выключена");
      const player = state.players[seat];
      if (!player || player.total < rules.super.modifiers.buyLetterCost) return actionError("poor", "На букву не хватает очков");
      const left = state.lettersLeft.map((count, index) => (index === seat ? count + 1 : count));
      return patch({ ...state, lettersLeft: left }, seat, (item) => ({ ...item, total: item.total - rules.super.modifiers.buyLetterCost }));
    }
    if ((state.phase === "letters" || state.phase === "sk-letters") && action.type === "letters") {
      const picked = lettersOf(action.letters, state.lettersLeft[seat] ?? 0, rules);
      if (!picked) return actionError("too_many_vowels", "Гласных больше, чем разрешено");
      const chosen = state.chosen.map((list, index) => (index === seat ? picked : list));
      const next = { ...state, chosen };
      if (state.phase === "letters") return closeLetters(next, rules);
      return state.finalists.every((item) => chosen[item]) ? closeLetters(next, rules) : next;
    }
    if (state.phase === "answer" && action.type === "solve") {
      const main = state.words[0];
      if (!main) return failSuper(state, rules, seat);
      const parts = action.text.split(/[,|\n]/).map((part) => part.trim()).filter(Boolean);
      if (!parts.some((part) => sameAnswer(part, main.answer, state.yoAsYe))) return failSuper(state, rules, seat);
      const bonus = state.words.slice(1).filter((word) => parts.some((part) => sameAnswer(part, word.answer, state.yoAsYe))).length;
      return winSuper(state, rules, seat, bonus);
    }
    if (state.phase === "sk-sabotage" && action.type === "sabotage") {
      if (action.kind !== "none" && action.kind !== "shield" && (action.target === undefined || !state.finalists.includes(action.target) || action.target === seat)) {
        return actionError("bad_target", "Пакость нужна против соперника");
      }
      const player = state.players[seat];
      if (action.kind !== "none" && player && player.total < rules.super.sabotage.cost) return actionError("poor", "На пакость не хватает очков");
      let next = patch(state, seat, (item) => ({ ...item, total: action.kind === "none" ? item.total : item.total - rules.super.sabotage.cost }));
      const sabotage = state.sabotage.map((item, index) => (index === seat ? { kind: action.kind, target: action.target ?? seat } : item));
      next = { ...next, sabotage };
      if (state.finalists.every((item) => sabotage[item])) return resolveSabotage(next, rules, rng, ctx.now);
      return next;
    }
    if (state.phase === "race" && action.type === "claim") {
      const player = state.players[seat];
      if (player && ctx.now > 0 && player.pausedUntil > ctx.now) return actionError("paused", "Пауза ещё не кончилась");
      const word = state.words[action.word];
      if (!word || word.owner !== null) return actionError("taken", "Это слово уже забрали");
      if (!sameAnswer(action.text, word.answer, state.yoAsYe)) {
        return say(patch(state, seat, (item) => ({ ...item, pausedUntil: ctx.now > 0 ? ctx.now + rules.super.wrongPauseSeconds * 1000 : 0 })), "Мимо, пауза", seat);
      }
      return claim(state, rules, seat, action.word, ctx.now);
    }
    return actionError("bad_phase", "Сейчас это действие не подходит");
  },

  passTurn: (state: PoleState, _seat, ctx): PoleState => {
    const rules = ctx.rules;
    if (state.phase === "math") {
      const sector = sectorOf(state, rules);
      const penalty = sector?.type === "math" ? sector.penalty : 0;
      return spinOrPass(patch(say(state, "Время примера вышло", state.turn), state.turn, (player) => ({ ...player, round: Math.max(0, player.round - penalty) })), rules, ctx.rng);
    }
    if (state.phase === "offer") return finishMatch(say(state, "Суперигру пропустили", state.turn));
    if (state.phase === "answer") return failSuper(state, rules, state.finalists[0] ?? state.turn);
    if (state.phase === "race") return finishMatch(say(state, "Время Схватки вышло"));
    if (state.phase === "sk-letters" || state.phase === "letters") {
      const chosen = state.chosen.map((list, index) => (state.finalists.includes(index) && list === null ? [] : list));
      return closeLetters({ ...state, chosen }, rules);
    }
    if (state.phase === "sk-sabotage") {
      const sabotage = state.sabotage.map((item, index) => (state.finalists.includes(index) && item === null ? { kind: "none" as const, target: index } : item));
      return resolveSabotage({ ...state, sabotage }, rules, ctx.rng, ctx.now);
    }
    if (state.phase === "wheel") return enterLetters({ ...state, wheelSpun: true }, rules, ctx.rng);
    return handTurn(say(state, "Время вышло", state.turn), rules, ctx.rng, false);
  },

  roundResult: (state) => state.result,

  view: (state: PoleState, seat): PoleView => {
    const yo = state.yoAsYe;
    const mine = seat === null ? [] : (state.chosen[seat] ?? []);
    const peeked = seat === null || !state.sabotageOpen ? [] : state.players[seat]?.peeks.map((other) => ({ seat: other, letters: state.chosen[other] ?? [] })) ?? [];
    const privateLetters = new Set<string>(state.phase === "race" || state.sabotageOpen ? mine : []);
    for (const item of peeked) for (const letter of item.letters) privateLetters.add(letter);
    const superPhase = SUPER.has(state.phase);
    return {
      phase: state.phase,
      you: seat,
      turn: state.turn,
      wordIndex: state.wordIndex,
      wordCount: state.wordCount,
      question: superPhase ? "" : state.question,
      tiles: state.tiles.map((tile) => ({ open: tile.open, ch: tile.open ? tile.ch : "" })),
      called: state.showCalled ? state.called : [],
      alphabet: state.alphabet,
      showCalled: state.showCalled,
      players: state.players.map((player, index) => ({
        total: player.total,
        round: player.round,
        lives: state.livesMax > 0 ? player.lives : 0,
        out: player.out,
        outRound: player.outRound,
        words: player.words,
        pausedUntil: player.pausedUntil,
        note: index === seat ? player.note : "",
      })),
      spin: state.spin,
      sector: state.sector,
      math: state.math ? { text: state.math.text, seconds: state.math.seconds, startedAt: state.math.startedAt } : null,
      chests: state.phase === "chests" ? state.chestCount : null,
      finalists: state.finalists,
      lettersLeft: seat === null ? 0 : (state.lettersLeft[seat] ?? 0),
      yours: mine,
      peeked,
      words: state.words.map((word) => ({
        question: state.hardcore ? "" : word.question,
        dir: word.dir,
        row: word.row,
        col: word.col,
        main: word.main,
        price: word.price,
        owner: word.owner ?? null,
        length: word.answer.length,
      })),
      cells: state.cells.map((cell) => {
        const open = state.openKeys.includes(cell.key) || privateLetters.has(canonChar(cell.ch, yo));
        return { key: cell.key, row: cell.row, col: cell.col, open, ch: open ? cell.ch : "", words: cell.words };
      }),
      raceEndsAt: state.raceEndsAt,
      events: state.events.filter((event) => !event.secret || event.seat === seat).map(({ id, text, seat: who }) => ({ id, text, seat: who })),
      result: state.result,
    };
  },

  guide: POLE_GUIDE,
  presets: PRESETS,
  slots: [{ path: "visual.center", title: "Центр барабана", accepts: ["asset"], advice: "Квадратная картинка, её видно в середине барабана. Прозрачный фон подходит." }],
  themes: (Object.entries(THEMES) as [keyof typeof THEMES, string][]).map(([id, description]) => ({ id, title: id, description })),
  visualCatalog: VISUAL_CATALOG,
});

function boxEvent(state: PoleState, rules: PoleRules, sector: Extract<Sector, { type: "prize" }>, event: (typeof sector.events)[number], rng: { pick<T>(items: readonly T[]): T; int(min: number, max: number): number; shuffle<T>(items: readonly T[]): T[] }): PoleState {
  const seat = state.turn;
  if (event === "tax") {
    const percent = rng.int(1, 99);
    return spinOrPass(say(patch(state, seat, (player) => ({ ...player, total: Math.floor(player.total * (1 - percent / 100)), round: Math.floor(player.round * (1 - percent / 100)) })), `Налог ${percent}%`, seat), rules, rng);
  }
  if (event === "note") {
    const hidden = state.tiles.filter((tile) => !tile.open && state.alphabet.includes(canonChar(tile.ch, state.yoAsYe)));
    const tile = hidden.length > 0 ? rng.pick(hidden) : null;
    const note = tile ? canonChar(tile.ch, state.yoAsYe).toLocaleUpperCase("ru-RU") : "";
    return spinOrPass(say(patch(state, seat, (player) => ({ ...player, note })), note ? `Записка: буква ${note}` : "Записка пустая", seat, true), rules, rng);
  }
  if (event === "luck") return spinOrPass(say(patch(state, seat, (player) => ({ ...player, luck: true })), "Удача в рулетке", seat), rules, rng);
  if (event === "anchor") return spinOrPass(say(patch(state, seat, (player) => ({ ...player, total: sector.anchorScore, round: 0 })), "Незыблемость", seat), rules, rng);
  return say({ ...state, phase: "detector", turnNo: state.turnNo + 1 }, "Детектор знаков: купить?");
}

export function sectorColor(visual: PoleVisual, index: number, own?: string): string {
  if (own) return own;
  const resolved = resolveVisual(visual);
  return resolved.palette[index % resolved.palette.length] ?? "#888888";
}
