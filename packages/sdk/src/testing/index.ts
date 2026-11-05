/**
 * Tiny games for engine and room tests. Not part of the catalog.
 * - race: turn-based, players add 1 or 2 to a shared counter, whoever reaches the target wins.
 * - drift: realtime, each player steers a dot; the first to reach the finish line wins.
 */
import { z } from "zod";
import { actionError, defineGame } from "../game";

const raceRules = z.strictObject({
  target: z.int().min(2).max(100).default(10),
  players: z.int().min(2).max(4).default(2),
}).prefault({});

interface RaceState {
  total: number;
  turn: number;
  moves: number;
  firstSeat: number;
  winner: number | null;
}

export const raceGame = defineGame({
  id: "race",
  version: 1,
  title: "Гонка до числа",
  summary: "Тестовая пошаговая игра",
  kind: "turn",
  rulesSchema: raceRules,
  visualSchema: z.strictObject({}).prefault({}),
  actionSchema: z.strictObject({ add: z.union([z.literal(1), z.literal(2)]) }),
  seats: (rules) => ({ min: rules.players, max: rules.players }),
  checkRules: (rules) => (rules.target < rules.players ? [{ path: "target", code: "too_small", message: "target меньше числа игроков" }] : []),
  setup: ({ firstSeat }): RaceState => ({ total: 0, turn: firstSeat, moves: 0, firstSeat, winner: null }),
  currentSeats: (s: RaceState) => (s.winner === null ? [s.turn] : []),
  turnId: (s: RaceState) => s.moves,
  legalActions: () => [{ add: 1 as const }, { add: 2 as const }],
  applyAction: (s: RaceState, seat, action, ctx) => {
    if (s.winner !== null) return actionError("finished", "Раунд окончен");
    const total = Math.min(s.total + action.add, ctx.rules.target);
    return { ...s, total, moves: s.moves + 1, turn: (s.turn + 1) % ctx.seats, winner: total >= ctx.rules.target ? seat : null };
  },
  passTurn: (s: RaceState, _seat, ctx) => ({ ...s, moves: s.moves + 1, turn: (s.turn + 1) % ctx.seats }),
  roundResult: (s: RaceState) =>
    s.winner === null
      ? null
      : { winners: [s.winner], losers: [], draw: false, reason: "target", summary: "дошёл до цели" },
  view: (s: RaceState, seat) => ({ ...s, you: seat }),
  guide: "Тестовая игра.",
  presets: [{ id: "default", title: "По умолчанию", description: "До 10", config: {} }],
  slots: [],
  themes: [],
  visualCatalog: {},
});

const driftRules = z.strictObject({
  length: z.int().min(10).max(1000).default(100),
  players: z.int().min(2).max(4).default(2),
}).prefault({});

interface DriftState {
  positions: number[];
  speeds: number[];
  winner: number | null;
}

export const driftGame = defineGame({
  id: "drift",
  version: 1,
  title: "Дрифт",
  summary: "Тестовая игра реального времени",
  kind: "realtime",
  tickRate: 10,
  rulesSchema: driftRules,
  visualSchema: z.strictObject({}).prefault({}),
  actionSchema: z.strictObject({ speed: z.int().min(0).max(5) }),
  seats: (rules) => ({ min: rules.players, max: rules.players }),
  setup: ({ seats }): DriftState => ({
    positions: Array.from({ length: seats }, () => 0),
    speeds: Array.from({ length: seats }, () => 0),
    winner: null,
  }),
  currentSeats: () => [],
  legalActions: () => [{ speed: 1 }, { speed: 3 }, { speed: 5 }],
  applyAction: (s: DriftState, seat, action) => {
    const speeds = [...s.speeds];
    speeds[seat] = action.speed;
    return { ...s, speeds };
  },
  tick: (s: DriftState, ctx) => {
    if (s.winner !== null) return s;
    const positions = s.positions.map((p, i) => p + (s.speeds[i] ?? 0));
    const best = Math.max(...positions);
    const winner = best >= ctx.rules.length ? positions.indexOf(best) : null;
    return { ...s, positions, winner };
  },
  roundResult: (s: DriftState) =>
    s.winner === null ? null : { winners: [s.winner], losers: [], draw: false, reason: "finish" },
  view: (s: DriftState) => s,
  guide: "Тестовая игра.",
  presets: [],
  slots: [],
  themes: [],
  visualCatalog: {},
});
