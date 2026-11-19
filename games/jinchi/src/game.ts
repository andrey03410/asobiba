import { actionError, defineGame, type GameContext, type RoundResult } from "@asobiba/sdk";
import { z } from "zod";
import { JINCHI_GUIDE } from "./guide";
import { JINCHI_PRESETS } from "./presets";
import { checkRules, diceSides, EMPTY, MAX_SIDE, rulesSchema, startPositions, WALL, type CellPosition, type EffectCell, type JinchiRules, type WeightedEffect } from "./rules";
import { captureTerritory } from './capture';
import { dimensions, findPlacements, hasPlacement, placementCapacity, placementError, samplePlacement, SIDES, CORNERS } from './placement';
export { createPlacementProbe, findPlacements, placementError } from './placement';
import { checkVisual, visualSchema } from "./visual";
import { JINCHI_INFO, JINCHI_PROMPT_EXAMPLES, JINCHI_TUNING, summarizeJinchiConfig } from './info';

export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("roll") }),
  z.strictObject({ type: z.literal("reroll") }),
  z.strictObject({ type: z.literal("skip-impossible") }),
  z.strictObject({ type: z.literal("place"), x: z.int().min(0).max(MAX_SIDE - 1), y: z.int().min(0).max(MAX_SIDE - 1), rotated: z.boolean().default(false) }),
]);
export type JinchiAction = z.output<typeof actionSchema>;
export interface JinchiEvent {
  id: number;
  seat: number;
  type: "roll" | "place" | "skip" | "capture" | "eliminate" | "objects" | "reroll";
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
  points: number[];
  flagCounts: number[];
  effectPoints: number[];
  rerollCharges: number[];
  /** Pending lock for each player's next own turn. */
  rotationLocked: boolean[];
  /** Active lock of the current turn; a newly collected lock stays pending. */
  turnRotationLocked: boolean;
  rerolled: boolean;
  impossibleRoll: boolean;
  flags: CellPosition[];
  effects: EffectCell[];
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
  canRotate: boolean;
  canReroll: boolean;
  canSkip: boolean;
}

const AUTO_ROLL_LIMIT = 256;
function activeSeat(state: JinchiState, seat: number): boolean {
  return Number.isInteger(seat) && seat >= 0 && seat < state.scores.length && !state.eliminated[seat];
}

/** Older renderer fixtures and restored v1 configs have no object bookkeeping. */
function completeState(state: JinchiState): JinchiState {
  if (state.points && state.flagCounts && state.rotationLocked) return state;
  const zeros = () => state.scores.map(() => 0);
  return { ...state, points: [...state.scores], flagCounts: zeros(), effectPoints: zeros(), rerollCharges: zeros(), rotationLocked: state.scores.map(() => false), turnRotationLocked: false, rerolled: false, impossibleRoll: false, flags: [], effects: [], ...Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined)) };
}
function canReroll(state: JinchiState): boolean {
  return Boolean(state.dice && !state.rerolled && state.rerollCharges[state.currentSeat]! > 0);
}
function recalculatePoints(state: JinchiState): JinchiState {
  const points = state.scores.map((score, seat) => score + state.effectPoints[seat]! + (state.rules.flags.mode === 'bonus' ? state.flagCounts[seat]! * state.rules.flags.value : 0));
  return { ...state, points };
}

function chooseEffect(pool: WeightedEffect[], ctx: GameContext<JinchiRules>): WeightedEffect {
  let choice = ctx.rng.next() * pool.reduce((sum, effect) => sum + effect.weight, 0);
  for (const effect of pool) {
    if (choice < effect.weight) return effect;
    choice -= effect.weight;
  }
  // A validated pool has a positive weight. Guard against rounding at its upper edge.
  return pool.findLast(effect => effect.weight > 0)!;
}

function collectObjects(state: JinchiState, seat: number, ctx: GameContext<JinchiRules>): JinchiState {
  const acquiredFlags = state.flags.filter(flag => state.cells[flag.y * state.width + flag.x] === seat);
  const acquiredEffects = state.effects.filter(effect => state.cells[effect.y * state.width + effect.x] === seat).sort((a, b) => a.y - b.y || a.x - b.x);
  if (!acquiredFlags.length && !acquiredEffects.length) return state;
  const flagCounts = [...state.flagCounts], effectPoints = [...state.effectPoints], rerollCharges = [...state.rerollCharges], rotationLocked = [...state.rotationLocked];
  flagCounts[seat]! += acquiredFlags.length;
  const descriptions: string[] = acquiredFlags.length ? [`Захвачено флагов: ${acquiredFlags.length}`] : [];
  for (const cell of acquiredEffects) {
    const effect = cell.kind === 'mystery' ? chooseEffect(state.rules.effects.mysteryPool, ctx) : cell;
    if (effect.kind === 'cache' || effect.kind === 'trap') {
      const value = effect.value ?? (effect.kind === 'cache' ? 25 : 15);
      effectPoints[seat]! += effect.kind === 'cache' ? value : -value;
      descriptions.push(effect.kind === 'cache' ? `тайник +${value}` : `ловушка −${value}`);
    } else if (effect.kind === 'reroll') {
      const overflow = rerollCharges[seat] === 3;
      rerollCharges[seat] = Math.min(3, rerollCharges[seat]! + 1);
      descriptions.push(overflow ? 'запасной бросок: достигнут предел 3' : 'запасной бросок +1');
    } else if (effect.kind === 'lock') {
      rotationLocked[seat] = true;
      descriptions.push('скованность на следующий собственный ход');
    }
  }
  const flags = state.flags.filter(flag => state.cells[flag.y * state.width + flag.x] !== seat);
  const effects = state.effects.filter(effect => state.cells[effect.y * state.width + effect.x] !== seat);
  return event({ ...state, flagCounts, effectPoints, rerollCharges, rotationLocked, flags, effects }, seat, 'objects', descriptions.join('; '));
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
  const active = state.scores.flatMap((_, seat) => !state.eliminated[seat] ? [seat] : []);
  const bestFlags = Math.max(...active.map(seat => state.flagCounts[seat]!));
  const contenders = state.rules.flags.mode === 'primary' ? active.filter(seat => state.flagCounts[seat] === bestFlags) : active;
  const best = Math.max(...contenders.map(seat => state.points[seat]!));
  const winners = forcedWinners ?? contenders.filter(seat => state.points[seat] === best);
  return { ...state, result: { winners, losers: state.scores.flatMap((_, seat) => winners.includes(seat) ? [] : [seat]), draw: winners.length > 1, reason, summary } };
}

function outcome(state: JinchiState): JinchiState {
  if (state.result) return state;
  const active = state.scores.flatMap((_, seat) => !state.eliminated[seat] ? [seat] : []);
  if (active.length === 1) return finish(state, "last-player", "остался один игрок", active);
  if (state.rules.flags.mode === 'primary' && state.rules.flags.target > 0) {
    const winners = active.filter(seat => state.flagCounts[seat]! >= state.rules.flags.target);
    if (winners.length) return finish(state, 'flag-target', 'достигнута цель по флагам', winners);
  }
  if (state.rules.flags.mode === 'off' && state.rules.end.targetPercent > 0) {
    const winners = active.filter((seat) => state.scores[seat]! * 100 >= state.rules.end.targetPercent * state.area);
    if (winners.length > 0) {
      const best = Math.max(...winners.map((seat) => state.scores[seat]!));
      return finish(state, "target-percent", "занята доля карты", winners.filter((seat) => state.scores[seat] === best));
    }
  }
  if (state.rules.flags.mode === 'primary' && state.rules.flags.positions.length > 0 && state.flags.length === 0) return finish(state, 'flags-collected', 'все флаги собраны');
  if (!canAnyoneGrow(state)) return finish(state, "board-full", "карта поделена");
  return state;
}

function completeTurn(state: JinchiState, placed: boolean): JinchiState {
  const active = state.scores.flatMap((_, seat) => !state.eliminated[seat] ? [seat] : []);
  const seen = [...new Set([...(state.cycleSeats ?? []), state.currentSeat])];
  const cyclePlaced = (state.cyclePlaced ?? false) || placed;
  let next: JinchiState = { ...state, dice: null, turn: state.turn + 1, cycleSeats: seen, cyclePlaced, rerolled: false, impossibleRoll: false, turnRotationLocked: false };
  if (active.every((seat) => seen.includes(seat))) {
    const skippedCycles = cyclePlaced ? 0 : (state.skippedCycles ?? 0) + 1;
    next = { ...next, skippedCycles };
    if (state.rules.end.skipRounds > 0 && skippedCycles >= state.rules.end.skipRounds) return finish(next, "all-skip", "все пропускают");
    if (state.rules.end.maxRounds > 0 && state.cycle >= state.rules.end.maxRounds) return finish(next, "max-rounds", "лимит кругов");
    next = { ...next, cycle: state.cycle + 1, cycleSeats: [], cyclePlaced: false };
  }
  for (let offset = 1; offset <= state.scores.length; offset++) {
    const seat = (state.currentSeat + offset) % state.scores.length;
    if (!state.eliminated[seat]) {
      const locked = Boolean(next.rotationLocked[seat]);
      const rotationLocked = locked ? next.rotationLocked.map((value, player) => player === seat ? false : value) : next.rotationLocked;
      return { ...next, currentSeat: seat, rotationLocked, turnRotationLocked: locked };
    }
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
  const viable: Array<[number, number]> = [];
  const blocked: Array<[number, number]> = [];
  const capacity = placementCapacity(state, seat);
  const [first, second] = diceSides(state.rules);
  const locked = seat === state.currentSeat ? state.turnRotationLocked : state.rotationLocked[seat];
  const fits = (a: number, b: number) => (capacity[b] ?? 0) >= a || (!locked && (capacity[a] ?? 0) >= b);
  if (typeof state.rules.dice.sides === 'number' && !locked) {
    // Preserve the v1 ordered-pair array order: old journal RNG indexes depend on it.
    for (let a = 1; a <= first; a++) for (let b = a; b <= second; b++) {
      const legal = fits(a, b);
      const list = legal ? viable : blocked;
      list.push([a, b]);
      if (a !== b) list.push([b, a]);
    }
  } else for (let a = 1; a <= first; a++) for (let b = 1; b <= second; b++) (fits(a, b) ? viable : blocked).push([a, b]);
  return { seat, viable, blocked, probability: viable.length / (first * second) };
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
      const [first, second] = diceSides(next.rules);
      const dice: [number, number] = [ctx.rng.int(1, first), ctx.rng.int(1, second)];
      next = event({ ...next, dice }, next.currentSeat, "roll", `Выпало ${dice[0]}:${dice[1]}`);
    }
    if (hasPlacement(next)) return { ...next, impossibleRoll: false };
    if (canReroll(next)) return { ...next, impossibleRoll: true };
    const [a, b] = next.dice!;
    next = event(next, next.currentSeat, "skip", `${a}×${b} — некуда поставить`);
    next = outcome(completeTurn(next, false));
    failedRolls++;
  }
  return next;
}

export const jinchi = defineGame({
  id: "jinchi", version: 1, title: "Jinchi", summary: "Территории, два кубика, флаги и сюрпризы на своей карте до 1000×1000 для 2–8 игроков", kind: "turn",
  rulesSchema, visualSchema, actionSchema,
  seats: (rules) => ({ min: rules.map.generation?.balanced ? rules.map.expectedPlayers ?? startPositions(rules).length : 2, max: startPositions(rules).length }),
  checkRules, checkVisual,
  simulationBudget: (rules) => ({ maxTotalActions: Math.max(200, Math.floor(20_000_000 / (rules.map.width * rules.map.height))), maxDurationMs: 1000 }),
  setup: ({ rules, seats, firstSeat, rng, now }): JinchiState => {
    rules = rulesSchema.parse(rules);
    const positions = startPositions(rules);
    const assigned = (rules.starts.assignment === "random" ? rng.shuffle(positions) : positions).slice(0, seats);
    const owners = new Map(assigned.map((position, seat) => [String(position), seat]));
    const cells: number[] = new Array(rules.map.width * rules.map.height);
    const bases: number[] = new Array(cells.length);
    let area = 0;
    for (let y = 0; y < rules.map.height; y++) for (let x = 0; x < rules.map.width; x++) {
      const c = rules.map.rows[y]![x]!;
      const i = y * rules.map.width + x;
      cells[i] = c === '#' ? WALL : c === '.' ? EMPTY : owners.get(c) ?? (rules.starts.unused === 'wall' ? WALL : EMPTY);
      bases[i] = owners.get(c) ?? EMPTY;
      if (cells[i] !== WALL) area++;
    }
    const scores = Array.from({ length: seats }, () => 0);
    for (const cell of cells) if (cell >= 0) scores[cell]!++;
    const state: JinchiState = {
      width: rules.map.width, height: rules.map.height, cells, bases, currentSeat: firstSeat, turn: 0, cycle: 1,
      dice: null, scores, eliminated: scores.map(() => false), events: [], lastMove: null, result: null, rules,
      points: [...scores], flagCounts: scores.map(() => 0), effectPoints: scores.map(() => 0), rerollCharges: scores.map(() => 0),
      rotationLocked: scores.map(() => false), turnRotationLocked: false, rerolled: false, impossibleRoll: false,
      flags: rules.flags.mode === 'off' ? [] : rules.flags.positions.map(flag => ({ ...flag })), effects: rules.effects.cells.map(effect => ({ ...effect })),
      area, cycleSeats: [], cyclePlaced: false, skippedCycles: 0,
    };
    return prepareTurn(state, { rules, seats, rng, now });
  },
  currentSeats: (state: JinchiState) => state.result ? [] : [state.currentSeat],
  turnId: (state: JinchiState) => state.turn,
  hasLegalAction: (state: JinchiState, seat): boolean => {
    state = completeState(state);
    return !state.result && state.currentSeat === seat && activeSeat(state, seat) && (!state.dice || canReroll(state) || hasPlacement(state));
  },
  sampleAction: (state: JinchiState, seat, ctx): JinchiAction | null => {
    state = completeState(state);
    if (state.result || state.currentSeat !== seat || !activeSeat(state, seat)) return null;
    if (!state.dice) {
      // Legacy SDK picked the sole roll action before throwing the two dice.
      ctx.rng.next();
      return { type: 'roll' };
    }
    // Timer/random policy does not spend a person's stored charge for them.
    return samplePlacement(state, seat, ctx.rng) ?? (canReroll(state) ? { type: 'skip-impossible' } : null);
  },
  legalActions: (state: JinchiState, seat): JinchiAction[] => {
    state = completeState(state);
    if (state.result || state.currentSeat !== seat || !activeSeat(state, seat)) return [];
    if (!state.dice) return [{ type: 'roll' }];
    const placements: JinchiAction[] = findPlacements(state, seat);
    if (canReroll(state)) {
      if (!placements.length) placements.push({ type: 'skip-impossible' });
      placements.push({ type: 'reroll' });
    }
    return placements;
  },
  applyAction: (state: JinchiState, seat, action: JinchiAction, ctx) => {
    state = completeState(state);
    if (state.result) return actionError("round-over", "Партия окончена");
    if (seat !== state.currentSeat || !activeSeat(state, seat)) return actionError("not-your-turn", "Сейчас не ваш ход");
    if (action.type === "roll") {
      if (state.dice) return actionError("already-rolled", "Кубики уже брошены");
      return prepareTurn(state, ctx, true);
    }
    if (action.type === 'reroll') {
      if (!canReroll(state)) return actionError('cannot-reroll', 'Переброс недоступен: нужен заряд и не более одного переброса за ход');
      const rerollCharges = [...state.rerollCharges];
      rerollCharges[seat]!--;
      const [first, second] = diceSides(state.rules);
      const dice: [number, number] = [ctx.rng.int(1, first), ctx.rng.int(1, second)];
      const next = event({ ...state, dice, rerollCharges, rerolled: true }, seat, 'reroll', `Переброс: ${dice[0]}:${dice[1]}`);
      return prepareTurn(next, ctx);
    }
    if (action.type === 'skip-impossible') {
      if (!canReroll(state) || hasPlacement(state)) return actionError('cannot-skip', 'Пропустить можно только невозможный исходный бросок с доступным зарядом');
      const next = event(state, seat, 'skip', 'Невозможный бросок пропущен, заряд сохранён');
      return prepareTurn(completeTurn(next, false), ctx);
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
    const { captured, enemies } = captureTerritory(next, seat);
    if (captured.length > 0) next = event(next, seat, "capture", `Окружено ${captured.length} клеток${enemies > 0 ? `, из них чужих — ${enemies}` : ""}`);
    const scores = [...state.scores];
    for (const index of [...indices, ...captured]) {
      const previous = state.cells[index]!;
      if (previous === seat) continue;
      scores[seat]!++;
      if (previous >= 0) scores[previous]!--;
    }
    next = { ...next, scores, eliminated: [...state.eliminated], lastMove: { seat, indices, captured, turn: state.turn } };
    next = recalculatePoints(collectObjects(next, seat, ctx));
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
    state = completeState(state);
    if (state.result || state.currentSeat !== seat) return state;
    const next = event(state, seat, "skip", "Время на ход вышло — ход пропущен");
    return prepareTurn(completeTurn(next, false), ctx);
  },
  roundResult: (state: JinchiState) => state.result,
  view: (state: JinchiState, seat): JinchiView => {
    state = completeState(state);
    const canAct = seat !== null && seat === state.currentSeat && !state.result && !state.eliminated[seat];
    const impossibleRoll = Boolean(state.dice && !state.result && !hasPlacement(state));
    return { ...state, canAct, impossibleRoll, canRotate: !state.turnRotationLocked, canReroll: canAct && canReroll(state), canSkip: canAct && impossibleRoll && canReroll(state) };
  },
  info: JINCHI_INFO, tuning: JINCHI_TUNING, promptExamples: JINCHI_PROMPT_EXAMPLES, examplePresetId: "duel",
  summarizeConfig: summarizeJinchiConfig,
  guide: JINCHI_GUIDE, presets: JINCHI_PRESETS, slots: [], themes: [],
  ai: [
    { role: "observer", description: "Следит за территориями, очками и открытыми событиями.", example: "Дай сводку по захватам после партии." },
    { role: "commentator", description: "Отмечает захваты, флаги и итоги раунда.", example: "Комментируй захват флагов и итог." },
  ],
  observeForAgent: ({ turn, currentSeat, dice, scores, points, flagCounts, eliminated, events }) => {
    const latest = events.at(-1);
    return {
      state: { turn, currentSeat, dice, scores, points, flagCounts, eliminated, latest },
      ...(latest && ["capture", "objects", "eliminate"].includes(latest.type)
        ? { comment: { key: String(latest.id), text: latest.text } } : {}),
    };
  },
  visualCatalog: { placeAnimations: { pop: "Появление фигуры", none: "Без анимации" }, captureAnimations: { wave: "Волна захвата", none: "Без анимации" } },
});
