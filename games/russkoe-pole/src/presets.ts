import type { ConfigPreset } from "@asobiba/sdk";
import type { SectorInput } from "./rules";

const timer = { turnSeconds: 0, onTimeout: "skip" as const };
const series = { rounds: 1, stopWhenDecided: false };

function points(value: number): SectorInput {
  return { type: "points", value };
}

const classicWheel: SectorInput[] = [
  points(350), points(400), points(500), points(500), points(600), points(700),
  points(800), points(900), points(1000), points(1000), points(1500),
  { type: "bankrupt" }, { type: "bankrupt" },
  { type: "zero" }, { type: "zero" },
  { type: "multiplier", k: 2 }, { type: "multiplier", k: 2 },
  { type: "plus" }, { type: "plus" },
  { type: "prize" }, { type: "chance", amount: 500 },
];

const familyWheel: SectorInput[] = [points(200), points(300), points(400), points(500), { type: "plus" }, { type: "chance", amount: 300 }, points(600), points(800)];

const chaosWheel: SectorInput[] = [
  { type: "roulette", bulletValue: 400, capacity: 6 },
  { type: "math", maxMultiplier: 3 },
  { type: "steal", share: 0.3 },
  { type: "swap" },
  { type: "hint" },
  { type: "prize" },
  { type: "chance", amount: 700 },
  { type: "bankrupt", loss: "round" },
  { type: "multiplier", k: 3 },
  points(1000),
];

const prototypeWheel: SectorInput[] = [
  points(350), points(500), points(750), points(1000),
  { type: "bankrupt", loss: "share", share: 0.99 },
  { type: "zero", penalty: 600 },
  { type: "multiplier", k: 2, miss: "half" },
  { type: "plus" },
  { type: "prize" },
  { type: "chance", amount: 500 },
  { type: "roulette", bulletValue: 1500, capacity: 6, consequence: "lose-match", hostChance: 0.13 },
  { type: "math", ops: ["add"], min: 1, max: 100, seconds: 12, maxMultiplier: 3, penalty: 0 },
];

export const PRESETS: ConfigPreset[] = [
  {
    id: "classic",
    title: "Классика",
    description: "Барабан как в студии, три слова, соло-суперигра, без штрафов за промах",
    config: {
      title: "Классика",
      series,
      timer,
      visual: { theme: "studio" },
      rules: {
        players: { min: 1, max: 4 },
        words: { rounds: 3, source: "bank" },
        wheel: classicWheel,
        scoring: { lives: 0, miss: "pass", repeat: "pass", wrongWord: "eliminate" },
        chests: { enabled: true, penalty: 0 },
        super: { mode: "solo", sabotage: { enabled: false } },
      },
    },
  },
  {
    id: "prototype",
    title: "Прототип",
    description: "Рулетка, примеры, доля на банкроте и штрафы за промах. Старт с 1000 очков",
    config: {
      title: "Прототип",
      series,
      timer,
      visual: { theme: "studio" },
      rules: {
        words: { rounds: 3, source: "bank" },
        wheel: prototypeWheel,
        scoring: { lives: 0, startingScore: 1000, loseAtZero: true, miss: "penalty", repeat: "half", wrongWord: "lose-match" },
        chests: { enabled: true, prize: 1500, penalty: 1500 },
        super: { mode: "solo", minScore: 1000 },
      },
    },
  },
  {
    id: "family",
    title: "Семейная",
    description: "Без банкрота, рулетки и штрафов. Мягкая суперигра",
    config: {
      title: "Семейная",
      series,
      timer,
      visual: { theme: "paper" },
      rules: {
        words: { rounds: 3, source: "bank" },
        wheel: familyWheel,
        scoring: { lives: 5, miss: "pass", wrongWord: "pass" },
        chests: { enabled: true, penalty: 0 },
        super: { mode: "auto", stake: { loseShare: 0 }, sabotage: { enabled: false } },
      },
    },
  },
  {
    id: "solo",
    title: "Соло",
    description: "Один игрок и пять жизней на слово",
    config: {
      title: "Соло",
      series,
      timer,
      visual: { theme: "studio" },
      rules: {
        players: { min: 1, max: 1 },
        words: { rounds: 3, source: "bank" },
        wheel: classicWheel,
        scoring: { lives: 5 },
        super: { mode: "solo" },
      },
    },
  },
  {
    id: "chaos",
    title: "Хаос",
    description: "Барабан почти из одних особых секторов и Схватка",
    config: {
      title: "Хаос",
      series,
      timer,
      visual: { theme: "neon" },
      rules: {
        players: { min: 2, max: 5 },
        words: { rounds: 2, source: "bank" },
        wheel: chaosWheel,
        scoring: { lives: 0 },
        super: { mode: "skhvatka", sabotage: { enabled: true }, modifiers: { prizeWheel: true } },
      },
    },
  },
  {
    id: "blitz",
    title: "Блиц",
    description: "Одно слово и короткие таймеры",
    config: {
      title: "Блиц",
      series,
      timer,
      visual: { theme: "neon" },
      rules: {
        words: { rounds: 1, source: "bank" },
        wheel: classicWheel,
        timers: { turnSeconds: 12, maxSpins: 20 },
        scoring: { lives: 0 },
        super: { answerSeconds: 20, lettersSeconds: 15, raceSeconds: 30 },
      },
    },
  },
];
