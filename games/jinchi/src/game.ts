import { actionError, defineGame, type GameContext, type RoundResult } from "@asobiba/sdk";
import { z } from "zod";
import { JINCHI_GUIDE } from "./guide";
import { PRESETS } from "./presets";
import { checkRules, EMPTY, MAX_SIDE, rulesSchema, startPositions, WALL, type JinchiRules } from "./rules";
import { checkVisual, visualSchema } from "./visual";

export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("roll") }),
  z.strictObject({ type: z.literal("place"), x: z.int().min(0).max(MAX_SIDE - 1), y: z.int().min(0).max(MAX_SIDE - 1), rotated: z.boolean().default(false) }),
]);
export type JinchiAction = z.output<typeof actionSchema>;
export interface JinchiEvent {
  id: number;
  seat: number;
  type: "roll" | "place" | "skip" | "capture" | "eliminate";
  text: string;
}
export interface JinchiState {
  width: number;
  height: number;
  /** -2 wall, -1 empty, 0…7 seat. */
  cells: number[];
  /** Original seat of each assigned start cell, otherwise -1. */
  bases: number[];
  currentSeat: number;
  turn: number;
  cycle: number;
  dice: [number, number] | null;
  scores: number[];
  eliminated: boolean[];
  events: JinchiEvent[];
  lastMove: { seat: number; indices: number[]; captured: number[]; turn: number } | null;
  result: RoundResult | null;
  rules: JinchiRules;
  area: number;
  /** Serializable cycle bookkeeping; optional for renderer fixtures. */
  cycleSeats?: number[];
  cyclePlaced?: boolean;
  skippedCycles?: number;
}
export interface JinchiView extends JinchiState {
  canAct: boolean;
}

type Placement = Extract<JinchiAction, { type: "place" }>;
const SIDES: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const CORNERS: ReadonlyArray<readonly [number, number]> = [...SIDES, [1, 1], [-1, 1], [1, -1], [-1, -1]];
const AUTO_ROLL_LIMIT = 256;

function dimensions(state: JinchiState, rotated: boolean): [number, number] | null {
  if (!state.dice) return null;
  return rotated ? [state.dice[1], state.dice[0]] : state.dice;
}

function activeSeat(state: JinchiState, seat: number): boolean {
  return Number.isInteger(seat) && seat >= 0 && seat < state.scores.length && !state.eliminated[seat];
}

/** Human-facing validation, shared by the server and rectangle ghost. */
export function placementError(state: JinchiState, seat: number, x: number, y: number, rotated: boolean): string | null {
  if (state.result) return "Партия окончена";
  if (!activeSeat(state, seat) || state.currentSeat !== seat) return "Сейчас не ваш ход";
  const size = dimensions(state, rotated);
  if (!size) return "Сначала бросьте кубики";
  const [width, height] = size;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + width > state.width || y + height > state.height) return "Фигура выходит за край карты";
  let empty = false;
  let own = false;
  const neighbors = state.rules.placement.adjacency === "side" ? SIDES : CORNERS;
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const cell = state.cells[(y + dy) * state.width + x + dx];
      if (cell === WALL) return "Фигура упирается в стену";
      if (cell !== EMPTY && cell !== seat) return "Фигура задевает чужую территорию";
      if (cell === seat) {
        if (!state.rules.placement.overlapOwn) return "Фигура накрывает свою территорию";
        own = true;
      } else empty = true;
      for (const [nx, ny] of neighbors) {
        const px = x + dx + nx;
        const py = y + dy + ny;
        if (px >= 0 && py >= 0 && px < state.width && py < state.height && state.cells[py * state.width + px] === seat) own = true;
      }
    }
  }
  if (!empty) return "В фигуре должна быть хотя бы одна свободная клетка";
  if (!own) return "Фигура не касается вашей территории";
  return null;
}

interface Sums {
  bad: Int32Array;
  own: Int32Array;
  empty: Int32Array;
  stride: number;
}

/** Summed-area tables make a complete rectangle search O(map area), not O(area × dice area). */
function sumsFor(state: JinchiState, seat: number): Sums {
  const stride = state.width + 1;
  const length = stride * (state.height + 1);
  const bad = new Int32Array(length);
  const own = new Int32Array(length);
  const empty = new Int32Array(length);
  for (let y = 0; y < state.height; y++) {
    let rowBad = 0;
    let rowOwn = 0;
    let rowEmpty = 0;
    for (let x = 0; x < state.width; x++) {
      const cell = state.cells[y * state.width + x];
      rowBad += cell !== EMPTY && !(cell === seat && state.rules.placement.overlapOwn) ? 1 : 0;
      rowOwn += cell === seat ? 1 : 0;
      rowEmpty += cell === EMPTY ? 1 : 0;
      const i = (y + 1) * stride + x + 1;
      bad[i] = bad[i - stride]! + rowBad;
      own[i] = own[i - stride]! + rowOwn;
      empty[i] = empty[i - stride]! + rowEmpty;
    }
  }
  return { bad, own, empty, stride };
}

function rectangle(table: Int32Array, stride: number, x: number, y: number, width: number, height: number): number {
  return table[(y + height) * stride + x + width]! - table[y * stride + x + width]! - table[(y + height) * stride + x]! + table[y * stride + x]!;
}

function search(state: JinchiState, sum: Sums, width: number, height: number, rotated: boolean, firstOnly = false): Placement[] {
  const out: Placement[] = [];
  for (let y = 0; y <= state.height - height; y++) {
    for (let x = 0; x <= state.width - width; x++) {
      if (rectangle(sum.bad, sum.stride, x, y, width, height) !== 0 || rectangle(sum.empty, sum.stride, x, y, width, height) === 0) continue;
      let adjacent = rectangle(sum.own, sum.stride, x, y, width, height);
      if (state.rules.placement.adjacency === "corner") {
        const left = Math.max(0, x - 1);
        const top = Math.max(0, y - 1);
        adjacent = rectangle(sum.own, sum.stride, left, top, Math.min(state.width, x + width + 1) - left, Math.min(state.height, y + height + 1) - top);
      } else {
        if (y > 0) adjacent += rectangle(sum.own, sum.stride, x, y - 1, width, 1);
        if (y + height < state.height) adjacent += rectangle(sum.own, sum.stride, x, y + height, width, 1);
        if (x > 0) adjacent += rectangle(sum.own, sum.stride, x - 1, y, 1, height);
        if (x + width < state.width) adjacent += rectangle(sum.own, sum.stride, x + width, y, 1, height);
      }
      if (adjacent === 0) continue;
      out.push({ type: "place", x, y, rotated });
      if (firstOnly) return out;
    }
  }
  return out;
}

export function findPlacements(state: JinchiState, seat: number, rotated?: boolean): Placement[] {
  if (state.result || !state.dice || !activeSeat(state, seat) || state.currentSeat !== seat) return [];
  const sum = sumsFor(state, seat);
  const rotations = rotated === undefined ? state.dice[0] === state.dice[1] ? [false] : [false, true] : [rotated];
  return rotations.flatMap((rotation) => {
    const [width, height] = dimensions(state, rotation)!;
    return search(state, sum, width, height, rotation);
  });
}

function hasPlacement(state: JinchiState): boolean {
  if (!state.dice) return false;
  const sum = sumsFor(state, state.currentSeat);
  const [a, b] = state.dice;
  return search(state, sum, a, b, false, true).length > 0 || (a !== b && search(state, sum, b, a, true, true).length > 0);
}

/** A single linear scan decides the unconditional end rule, independent of dice. */
function canAnyoneGrow(state: JinchiState): boolean {
  const neighbors = state.rules.placement.adjacency === "side" ? SIDES : CORNERS;
  for (let i = 0; i < state.cells.length; i++) {
    if (state.cells[i] !== EMPTY) continue;
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    for (const [dx, dy] of neighbors) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= state.width || py >= state.height) continue;
      const seat = state.cells[py * state.width + px]!;
      if (seat >= 0 && !state.eliminated[seat]) return true;
    }
  }
  return false;
}

function event(state: JinchiState, seat: number, type: JinchiEvent["type"], text: string): JinchiState {
  const id = (state.events.at(-1)?.id ?? -1) + 1;
  return { ...state, events: [...state.events.slice(-99), { id, seat, type, text }] };
}

function finish(state: JinchiState, reason: string, summary: string, forcedWinners?: number[]): JinchiState {
  const best = Math.max(...state.scores);
  const winners = forcedWinners ?? state.scores.flatMap((score, seat) => score === best ? [seat] : []);
  return { ...state, result: { winners, losers: state.scores.flatMap((_, seat) => winners.includes(seat) ? [] : [seat]), draw: winners.length > 1, reason, summary } };
}

function outcome(state: JinchiState): JinchiState {
  if (state.result) return state;
  const active = state.scores.flatMap((_, seat) => !state.eliminated[seat] ? [seat] : []);
  if (active.length === 1) return finish(state, "last-player", "остался один игрок", active);
  if (state.rules.end.targetPercent > 0) {
    const winners = active.filter((seat) => state.scores[seat]! * 100 >= state.rules.end.targetPercent * state.area);
    if (winners.length > 0) {
      const best = Math.max(...winners.map((seat) => state.scores[seat]!));
      return finish(state, "target-percent", "занята доля карты", winners.filter((seat) => state.scores[seat] === best));
    }
  }
  if (!canAnyoneGrow(state)) return finish(state, "board-full", "карта поделена");
  return state;
}

function completeTurn(state: JinchiState, placed: boolean): JinchiState {
  const active = state.scores.flatMap((_, seat) => !state.eliminated[seat] ? [seat] : []);
  const seen = [...new Set([...(state.cycleSeats ?? []), state.currentSeat])];
  const cyclePlaced = (state.cyclePlaced ?? false) || placed;
  let next: JinchiState = { ...state, dice: null, turn: state.turn + 1, cycleSeats: seen, cyclePlaced };
  if (active.every((seat) => seen.includes(seat))) {
    const skippedCycles = cyclePlaced ? 0 : (state.skippedCycles ?? 0) + 1;
    next = { ...next, skippedCycles };
    if (state.rules.end.skipRounds > 0 && skippedCycles >= state.rules.end.skipRounds) return finish(next, "all-skip", "все пропускают");
    if (state.rules.end.maxRounds > 0 && state.cycle >= state.rules.end.maxRounds) return finish(next, "max-rounds", "лимит кругов");
    next = { ...next, cycle: state.cycle + 1, cycleSeats: [], cyclePlaced: false };
  }
  for (let offset = 1; offset <= state.scores.length; offset++) {
    const seat = (state.currentSeat + offset) % state.scores.length;
    if (!state.eliminated[seat]) return { ...next, currentSeat: seat };
  }
  return next;
}

interface DiceModel {
  seat: number;
  viable: Array<[number, number]>;
  blocked: Array<[number, number]>;
  probability: number;
}

function diceModel(state: JinchiState, seat: number): DiceModel {
  const sum = sumsFor(state, seat);
  const viable: Array<[number, number]> = [];
  const blocked: Array<[number, number]> = [];
  const hasGrowth = search(state, sum, 1, 1, false, true).length > 0;
  for (let a = 1; a <= state.rules.dice.sides; a++) {
    for (let b = a; b <= state.rules.dice.sides; b++) {
      const legal = hasGrowth && (search(state, sum, a, b, false, true).length > 0 || (a !== b && search(state, sum, b, a, true, true).length > 0));
      const list = legal ? viable : blocked;
      list.push([a, b]);
      if (a !== b) list.push([b, a]);
    }
  }
  return { seat, viable, blocked, probability: viable.length / state.rules.dice.sides ** 2 };
}

/**
 * Exact rejection-sampling acceleration: sample complete losing rotations geometrically,
 * then the first successful seat and a uniform legal ordered dice pair. Each skipped
 * throw is still sampled from that seat's losing pairs, logged and counted toward limits.
 * This preserves the distribution of fair independent dice instead of forcing a success.
 */
function acceleratedRoll(state: JinchiState, ctx: GameContext<JinchiRules>): JinchiState {
  const models: DiceModel[] = [];
  for (let offset = 0; offset < state.scores.length; offset++) {
    const seat = (state.currentSeat + offset) % state.scores.length;
    if (!state.eliminated[seat]) models.push(diceModel(state, seat));
  }
  const losingRotation = models.reduce((probability, model) => probability * (1 - model.probability), 1);
  const uniform = Math.min(1 - Number.EPSILON, Math.max(0, ctx.rng.next()));
  const fullRotations = losingRotation === 0 ? 0 : Math.floor(Math.log1p(-uniform) / Math.log(losingRotation));
  let choice = ctx.rng.next() * (1 - losingRotation);
  let previousFailures = 1;
  let successfulIndex = models.findLastIndex((model) => model.viable.length > 0);
  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    const weight = previousFailures * model.probability;
    if (choice < weight) {
      successfulIndex = i;
      break;
    }
    choice -= weight;
    previousFailures *= 1 - model.probability;
  }
  const failures = fullRotations * models.length + successfulIndex;
  let next = state;
  for (let i = 0; i < failures; i++) {
    const model = models[i % models.length]!;
    const dice = ctx.rng.pick(model.blocked);
    next = event({ ...next, dice }, model.seat, "roll", `Выпало ${dice[0]}:${dice[1]}`);
    next = event(next, model.seat, "skip", `${dice[0]}×${dice[1]} — некуда поставить`);
    next = completeTurn(next, false);
    if (next.result) return next;
  }
  const winner = models[successfulIndex]!;
  const dice = ctx.rng.pick(winner.viable);
  return event({ ...next, dice }, winner.seat, "roll", `Выпало ${dice[0]}:${dice[1]}`);
}

function prepareTurn(state: JinchiState, ctx: GameContext<JinchiRules>, manualRoll = false): JinchiState {
  let next = outcome(state);
  let failedRolls = 0;
  while (!next.result) {
    if (!next.dice) {
      if (next.rules.dice.roll === "manual" && !manualRoll) return next;
      manualRoll = false;
      if (failedRolls >= AUTO_ROLL_LIMIT) return acceleratedRoll(next, ctx);
      const dice: [number, number] = [ctx.rng.int(1, next.rules.dice.sides), ctx.rng.int(1, next.rules.dice.sides)];
      next = event({ ...next, dice }, next.currentSeat, "roll", `Выпало ${dice[0]}:${dice[1]}`);
    }
    if (hasPlacement(next)) return next;
    const [a, b] = next.dice!;
    next = event(next, next.currentSeat, "skip", `${a}×${b} — некуда поставить`);
    next = outcome(completeTurn(next, false));
    failedRolls++;
  }
  return next;
}

/** Flood components iteratively; walls are traversable in own-cells-only mode. */
function captureCells(state: JinchiState, seat: number): { captured: number[]; enemies: number } {
  const { width, height, cells, rules } = state;
  const visited = new Uint8Array(cells.length);
  const queue = new Int32Array(cells.length);
  const neighbors = rules.capture.diagonal ? SIDES : CORNERS;
  const components: Array<{ indices: number[]; touches: boolean; edge: boolean }> = [];
  for (let i = 0; i < cells.length; i++) {
    if (visited[i] || cells[i] === seat || (rules.capture.walls && cells[i] === WALL)) continue;
    const component = { indices: [] as number[], touches: false, edge: false };
    let head = 0;
    let tail = 1;
    queue[0] = i;
    visited[i] = 1;
    while (head < tail) {
      const index = queue[head++]!;
      component.indices.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) component.edge = true;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (cells[ni] === seat) component.touches = true;
        else if (!visited[ni] && (!rules.capture.walls || cells[ni] !== WALL)) {
          visited[ni] = 1;
          queue[tail++] = ni;
        }
      }
    }
    components.push(component);
  }
  const largest = rules.capture.walls ? Math.max(0, ...components.filter((c) => c.touches).map((c) => c.indices.length)) : 0;
  const captured: number[] = [];
  let enemies = 0;
  for (const component of components) {
    if (!component.touches || (rules.capture.walls ? component.indices.length === largest : component.edge)) continue;
    for (const index of component.indices) {
      const owner = cells[index]!;
      if (owner === WALL || owner === seat) continue;
      if (owner >= 0 && (rules.capture.opponents === "none" || (rules.capture.opponents === "except-starts" && state.bases[index] !== EMPTY))) continue;
      if (owner >= 0) enemies++;
      cells[index] = seat;
      captured.push(index);
    }
  }
  return { captured, enemies };
}

export const jinchi = defineGame({
  id: "jinchi", version: 1, title: "Jinchi", summary: "Территории, два кубика и захват кольцом на своей карте до 200×200 для 2–8 игроков", kind: "turn",
  rulesSchema, visualSchema, actionSchema,
  seats: (rules) => ({ min: 2, max: startPositions(rules).length }),
  checkRules, checkVisual,
  simulationBudget: (rules) => ({ maxTotalActions: Math.max(200, Math.floor(20_000_000 / (rules.map.width * rules.map.height))), maxDurationMs: 1000 }),
  setup: ({ rules, seats, firstSeat, rng, now }): JinchiState => {
    const positions = startPositions(rules);
    const assigned = (rules.starts.assignment === "random" ? rng.shuffle(positions) : positions).slice(0, seats);
    const owners = new Map(assigned.map((position, seat) => [String(position), seat]));
    const cells = rules.map.rows.join("").split("").map((c) => c === "#" ? WALL : c === "." ? EMPTY : owners.get(c) ?? (rules.starts.unused === "wall" ? WALL : EMPTY));
    const bases = rules.map.rows.join("").split("").map((c) => owners.get(c) ?? EMPTY);
    const scores = Array.from({ length: seats }, () => 0);
    for (const cell of cells) if (cell >= 0) scores[cell]!++;
    const state: JinchiState = {
      width: rules.map.width, height: rules.map.height, cells, bases, currentSeat: firstSeat, turn: 0, cycle: 1,
      dice: null, scores, eliminated: scores.map(() => false), events: [], lastMove: null, result: null, rules,
      area: cells.filter((cell) => cell !== WALL).length, cycleSeats: [], cyclePlaced: false, skippedCycles: 0,
    };
    return prepareTurn(state, { rules, seats, rng, now });
  },
  currentSeats: (state: JinchiState) => state.result ? [] : [state.currentSeat],
  turnId: (state: JinchiState) => state.turn,
  legalActions: (state: JinchiState, seat): JinchiAction[] => state.result || state.currentSeat !== seat || !activeSeat(state, seat) ? [] : state.dice ? findPlacements(state, seat) : [{ type: "roll" }],
  applyAction: (state: JinchiState, seat, action: JinchiAction, ctx) => {
    if (state.result) return actionError("round-over", "Партия окончена");
    if (seat !== state.currentSeat || !activeSeat(state, seat)) return actionError("not-your-turn", "Сейчас не ваш ход");
    if (action.type === "roll") {
      if (state.dice) return actionError("already-rolled", "Кубики уже брошены");
      return prepareTurn(state, ctx, true);
    }
    const error = placementError(state, seat, action.x, action.y, action.rotated);
    if (error) return actionError("bad-placement", error);
    const [width, height] = dimensions(state, action.rotated)!;
    const cells = [...state.cells];
    const indices: number[] = [];
    for (let y = action.y; y < action.y + height; y++) {
      for (let x = action.x; x < action.x + width; x++) {
        const i = y * state.width + x;
        cells[i] = seat;
        indices.push(i);
      }
    }
    let next = event({ ...state, cells }, seat, "place", `Поставлен прямоугольник ${width}×${height}`);
    const { captured, enemies } = captureCells(next, seat);
    if (captured.length > 0) next = event(next, seat, "capture", `Окружено ${captured.length} клеток${enemies > 0 ? `, из них чужих — ${enemies}` : ""}`);
    const scores = Array.from({ length: state.scores.length }, () => 0);
    for (const cell of cells) if (cell >= 0) scores[cell]!++;
    next = { ...next, scores, eliminated: [...state.eliminated], lastMove: { seat, indices, captured, turn: state.turn } };
    for (let player = 0; player < scores.length; player++) {
      if (scores[player] === 0 && !next.eliminated[player]) {
        next.eliminated[player] = true;
        next = event(next, player, "eliminate", "Игрок потерял все клетки и выбыл");
      }
    }
    next = outcome(next);
    return next.result ? next : prepareTurn(completeTurn(next, true), ctx);
  },
  passTurn: (state: JinchiState, seat, ctx) => {
    if (state.result || state.currentSeat !== seat) return state;
    const next = event(state, seat, "skip", "Время на ход вышло — ход пропущен");
    return prepareTurn(completeTurn(next, false), ctx);
  },
  roundResult: (state: JinchiState) => state.result,
  view: (state: JinchiState, seat): JinchiView => ({ ...state, canAct: seat !== null && seat === state.currentSeat && !state.result && !state.eliminated[seat] }),
  guide: JINCHI_GUIDE, presets: PRESETS, slots: [], themes: [],
  visualCatalog: { placeAnimations: { pop: "Появление фигуры", none: "Без анимации" }, captureAnimations: { wave: "Волна захвата", none: "Без анимации" } },
});
