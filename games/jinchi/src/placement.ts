import type { Rng } from '@asobiba/sdk';
import { EMPTY, WALL, type JinchiRules } from './rules';

export interface PlacementBoard {
  width: number;
  height: number;
  cells: number[];
  rules: JinchiRules;
}
export interface PlacementState extends PlacementBoard {
  currentSeat: number;
  dice: [number, number] | null;
  scores: number[];
  eliminated: boolean[];
  result: unknown;
  turnRotationLocked?: boolean;
}
export interface PlacementAction { type: 'place'; x: number; y: number; rotated: boolean }
export const SIDES: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const CORNERS: ReadonlyArray<readonly [number, number]> = [...SIDES, [1, 1], [-1, 1], [1, -1], [-1, -1]];

export function dimensions(state: Pick<PlacementState, 'dice'>, rotated: boolean): [number, number] | null {
  if (!state.dice) return null;
  return rotated ? [state.dice[1], state.dice[0]] : state.dice;
}
function active(state: PlacementState, seat: number): boolean {
  return Number.isInteger(seat) && seat >= 0 && seat < state.scores.length && !state.eliminated[seat];
}

/** Server-authoritative validation also used by the client rectangle ghost. */
export function placementError(state: PlacementState, seat: number, x: number, y: number, rotated: boolean): string | null {
  if (state.result) return 'Партия окончена';
  if (!active(state, seat) || state.currentSeat !== seat) return 'Сейчас не ваш ход';
  if (rotated && state.turnRotationLocked) return 'Скованность: в этом ходу нельзя поворачивать фигуру';
  const size = dimensions(state, rotated);
  if (!size) return 'Сначала бросьте кубики';
  const [width, height] = size;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + width > state.width || y + height > state.height) return 'Фигура выходит за край карты';
  let empty = false;
  let own = false;
  const neighbors = state.rules.placement.adjacency === 'side' ? SIDES : CORNERS;
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
    const cell = state.cells[(y + dy) * state.width + x + dx];
    if (cell === WALL) return 'Фигура упирается в стену';
    if (cell !== EMPTY && cell !== seat) return 'Фигура задевает чужую территорию';
    if (cell === seat) {
      if (!state.rules.placement.overlapOwn) return 'Фигура накрывает свою территорию';
      own = true;
    } else empty = true;
    if (!own) for (const [nx, ny] of neighbors) {
      const px = x + dx + nx;
      const py = y + dy + ny;
      if (px >= 0 && py >= 0 && px < state.width && py < state.height && state.cells[py * state.width + px] === seat) { own = true; break; }
    }
  }
  if (!empty) return 'В фигуре должна быть хотя бы одна свободная клетка';
  return own ? null : 'Фигура не касается вашей территории';
}

interface Sums { bad: Int32Array; own: Int32Array; empty: Int32Array; stride: number }
interface GeometryCache { sums?: Sums; capacity?: number[] }
// Cells are immutable between actions. Dice, pending effects and clock changes reuse topology.
const cache = new WeakMap<number[], Map<string, GeometryCache>>();
function entry(state: PlacementBoard, seat: number): GeometryCache {
  let bySeat = cache.get(state.cells);
  if (!bySeat) { bySeat = new Map(); cache.set(state.cells, bySeat); }
  const key = `${state.width}:${state.height}:${seat}:${state.rules.placement.overlapOwn}:${state.rules.placement.adjacency}`;
  let value = bySeat.get(key);
  if (!value) { value = {}; bySeat.set(key, value); }
  return value;
}
function sumsFor(state: PlacementBoard, seat: number): Sums {
  const memo = entry(state, seat);
  if (memo.sums) return memo.sums;
  const stride = state.width + 1;
  const length = stride * (state.height + 1);
  const bad = new Int32Array(length), own = new Int32Array(length), empty = new Int32Array(length);
  for (let y = 0; y < state.height; y++) {
    let rowBad = 0, rowOwn = 0, rowEmpty = 0;
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
  return memo.sums = { bad, own, empty, stride };
}
function rectangle(table: Int32Array, stride: number, x: number, y: number, width: number, height: number): number {
  return table[(y + height) * stride + x + width]! - table[y * stride + x + width]! - table[(y + height) * stride + x]! + table[y * stride + x]!;
}
function scan(state: PlacementState, seat: number, rotated: boolean, visit: (x: number, y: number) => boolean): void {
  const [width, height] = dimensions(state, rotated)!;
  if (width > state.width || height > state.height) return;
  const sum = sumsFor(state, seat);
  for (let y = 0; y <= state.height - height; y++) for (let x = 0; x <= state.width - width; x++) {
    if (rectangle(sum.bad, sum.stride, x, y, width, height) !== 0 || rectangle(sum.empty, sum.stride, x, y, width, height) === 0) continue;
    let adjacent = rectangle(sum.own, sum.stride, x, y, width, height);
    if (state.rules.placement.adjacency === 'corner') {
      const left = Math.max(0, x - 1), top = Math.max(0, y - 1);
      adjacent = rectangle(sum.own, sum.stride, left, top, Math.min(state.width, x + width + 1) - left, Math.min(state.height, y + height + 1) - top);
    } else {
      if (y > 0) adjacent += rectangle(sum.own, sum.stride, x, y - 1, width, 1);
      if (y + height < state.height) adjacent += rectangle(sum.own, sum.stride, x, y + height, width, 1);
      if (x > 0) adjacent += rectangle(sum.own, sum.stride, x - 1, y, 1, height);
      if (x + width < state.width) adjacent += rectangle(sum.own, sum.stride, x + width, y, 1, height);
    }
    if (adjacent > 0 && !visit(x, y)) return;
  }
}
function rotations(state: PlacementState, rotated?: boolean): boolean[] {
  if (rotated !== undefined) return rotated && state.turnRotationLocked ? [] : [rotated];
  return state.turnRotationLocked || state.dice![0] === state.dice![1] ? [false] : [false, true];
}
export function findPlacements(state: PlacementState, seat: number, rotated?: boolean, limit = Infinity): PlacementAction[] {
  if (state.result || !state.dice || !active(state, seat) || state.currentSeat !== seat || limit <= 0) return [];
  const out: PlacementAction[] = [];
  for (const rotation of rotations(state, rotated)) {
    scan(state, seat, rotation, (x, y) => { out.push({ type: 'place', x, y, rotated: rotation }); return out.length < limit; });
    if (out.length >= limit) break;
  }
  return out;
}

/** Uniform across all legal anchors, with one RNG draw and no array of actions. */
export function samplePlacement(state: PlacementState, seat: number, rng: Rng): PlacementAction | null {
  if (state.result || !state.dice || !active(state, seat) || state.currentSeat !== seat) return null;
  let count = 0;
  const orientation = rotations(state);
  for (const rotation of orientation) scan(state, seat, rotation, () => { count++; return true; });
  if (!count) return null;
  let selected = rng.int(0, count - 1);
  let action: PlacementAction | null = null;
  for (const rotation of orientation) {
    scan(state, seat, rotation, (x, y) => { if (selected-- !== 0) return true; action = { type: 'place', x, y, rotated: rotation }; return false; });
    if (action) return action;
  }
  return null;
}

/**
 * Maximum width for each height 1…100. Every legal rectangle contains an empty
 * frontier cell adjoining our territory, including when own overlap is enabled.
 * Enumerate maximal allowed histogram rectangles and query that frontier by SAT.
 * Any smaller size can be carved around its frontier cell, so the profile is exact.
 */
export function placementCapacity(state: PlacementBoard, seat: number): number[] {
  const memo = entry(state, seat);
  if (memo.capacity) return memo.capacity;
  const { width, height, cells } = state;
  const stride = width + 1;
  const marks = new Int32Array(stride * (height + 1));
  const neighbors = state.rules.placement.adjacency === 'side' ? SIDES : CORNERS;
  for (let y = 0; y < height; y++) {
    let marked = 0;
    for (let x = 0; x < width; x++) {
      if (cells[y * width + x] === EMPTY) for (const [dx, dy] of neighbors) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && cells[ny * width + nx] === seat) { marked++; break; }
      }
      const i = (y + 1) * stride + x + 1;
      marks[i] = marks[i - stride]! + marked;
    }
  }
  const heights = new Int32Array(width + 1);
  const stack = new Int32Array(width + 1);
  const capacity = Array.from({ length: 101 }, () => 0);
  for (let y = 0; y < height; y++) {
    let top = 0;
    for (let x = 0; x <= width; x++) {
      const cell = cells[y * width + x];
      heights[x] = x < width && (cell === EMPTY || (state.rules.placement.overlapOwn && cell === seat)) ? heights[x]! + 1 : 0;
      while (top > 0 && heights[stack[top - 1]!]! > heights[x]!) {
        const h = heights[stack[--top]!]!;
        const left = top > 0 ? stack[top - 1]! + 1 : 0;
        const w = x - left;
        if (rectangle(marks, stride, left, y + 1 - h, w, h) > 0) capacity[Math.min(100, h)] = Math.max(capacity[Math.min(100, h)]!, Math.min(100, w));
      }
      stack[top++] = x;
    }
  }
  for (let h = 99; h >= 1; h--) capacity[h] = Math.max(capacity[h]!, capacity[h + 1]!);
  return memo.capacity = capacity;
}

export function hasPlacement(state: PlacementState): boolean {
  if (!state.dice) return false;
  const capacity = placementCapacity(state, state.currentSeat);
  const [a, b] = state.dice;
  return (capacity[b] ?? 0) >= a || (!state.turnRotationLocked && (capacity[a] ?? 0) >= b);
}

export function createPlacementProbe(state: PlacementState, seat: number): (x: number, y: number, rotated: boolean) => string | null {
  return (x, y, rotated) => placementError(state, seat, x, y, rotated);
}
