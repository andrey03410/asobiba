import type { MatchView } from "@asobiba/sdk";

const MAX_SIDE = 1000;
const MAX_CELLS = MAX_SIDE * MAX_SIDE;
const SYMBOLS = "#.12345678";

export interface PackedGrid {
  encoding: "runs" | "raw";
  data: string;
  length: number;
}

interface PackedIndices {
  encoding: "ranges" | "raw";
  data: number[];
  length: number;
}

type ObjectValue = Record<string, unknown>;
const grids = new WeakMap<readonly number[], PackedGrid>();
const maps = new WeakMap<readonly string[], PackedGrid>();
const indicesCache = new WeakMap<readonly number[], { area: number; packed: PackedIndices }>();

function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function invalid(): never { throw new Error("Некорректный компактный снимок Jinchi"); }
function length(value: unknown, max = MAX_CELLS): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) invalid();
  return value;
}
function dimensions(game: ObjectValue, map: ObjectValue): { width: number; height: number; area: number } {
  const width = length(game.width, MAX_SIDE), height = length(game.height, MAX_SIDE);
  if (!width || !height || width !== map.width || height !== map.height) invalid();
  return { width, height, area: width * height };
}
function envelope(value: unknown): value is ObjectValue & { rules: ObjectValue & { map: ObjectValue } } {
  return object(value) && "cells" in value && "bases" in value && object(value.rules) && object(value.rules.map);
}

/** Counts use base 36; separators keep cell digits unambiguous. Raw is never over one character per cell. */
function encodeCharacters(raw: string): PackedGrid {
  const parts: string[] = [];
  let used = 0;
  for (let start = 0; start < raw.length;) {
    const symbol = raw[start]!;
    let end = start + 1;
    while (end < raw.length && raw[end] === symbol) end++;
    const part = `${(end - start).toString(36)}:${symbol};`;
    used += part.length;
    if (used >= raw.length) return { encoding: "raw", data: raw, length: raw.length };
    parts.push(part);
    start = end;
  }
  return { encoding: "runs", data: parts.join(""), length: raw.length };
}

export function encodeGrid(cells: readonly number[]): PackedGrid {
  const cached = grids.get(cells);
  if (cached) return cached;
  length(cells.length);
  const chunks: string[] = [];
  let chunk = "";
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    if (!Number.isInteger(cell) || cell < -2 || cell > 7) invalid();
    chunk += SYMBOLS[cell + 2];
    if (chunk.length === 4096) { chunks.push(chunk); chunk = ""; }
  }
  if (chunk) chunks.push(chunk);
  const packed = encodeCharacters(chunks.join(""));
  grids.set(cells, packed);
  return packed;
}

function walkRuns(data: string, expected: number, run?: (value: number, from: number, to: number) => void) {
  let offset = 0;
  for (let at = 0; at < data.length;) {
    const colon = data.indexOf(":", at);
    if (colon < at + 1 || colon - at > 4 || data[colon + 2] !== ";") invalid();
    const digits = data.slice(at, colon);
    if (!/^[0-9a-z]+$/.test(digits)) invalid();
    const count = Number.parseInt(digits, 36);
    const value = SYMBOLS.indexOf(data[colon + 1] ?? "!") - 2;
    if (count < 1 || count > expected - offset || value < -2 || value > 7) invalid();
    run?.(value, offset, offset + count);
    offset += count;
    at = colon + 3;
  }
  if (offset !== expected) invalid();
}

function checkedGrid(input: unknown, expectedLength: number): PackedGrid {
  length(expectedLength);
  if (!object(input) || input.length !== expectedLength || typeof input.data !== "string" || input.data.length > expectedLength) invalid();
  if (input.encoding === "raw") {
    if (input.data.length !== expectedLength || /[^#.1-8]/.test(input.data)) invalid();
  } else if (input.encoding === "runs") walkRuns(input.data, expectedLength);
  else invalid();
  return input as unknown as PackedGrid;
}

/** The complete payload is validated before allocating the decoded board. */
export function decodeGrid(input: unknown, expectedLength: number): number[] {
  const packed = checkedGrid(input, expectedLength);
  const cells = new Array<number>(expectedLength);
  if (packed.encoding === "raw") {
    for (let i = 0; i < expectedLength; i++) cells[i] = SYMBOLS.indexOf(packed.data[i]!) - 2;
  } else walkRuns(packed.data, expectedLength, (value, from, to) => cells.fill(value, from, to));
  return cells;
}

function encodeRows(rows: readonly string[], width: number, height: number): PackedGrid {
  if (rows.length !== height) invalid();
  const cached = maps.get(rows);
  if (cached && cached.length === width * height) return cached;
  for (const row of rows) if (typeof row !== "string" || row.length !== width || /[^#.1-8]/.test(row)) invalid();
  const packed = encodeCharacters(rows.join(""));
  maps.set(rows, packed);
  return packed;
}

function encodeIndices(input: readonly number[], area: number): PackedIndices {
  const cached = indicesCache.get(input);
  if (cached?.area === area) return cached.packed;
  length(input.length, area);
  const ranges: number[] = [];
  let rangesUseful = true;
  for (let at = 0; at < input.length;) {
    const first = input[at]!;
    if (!Number.isInteger(first) || first < 0 || first >= area) invalid();
    let end = at + 1;
    while (end < input.length && input[end] === first + end - at) end++;
    if (first + end - at > area) invalid();
    if (rangesUseful) {
      ranges.push(first, end - at);
      if (ranges.length >= input.length) { rangesUseful = false; ranges.length = 0; }
    }
    at = end;
  }
  const packed: PackedIndices = rangesUseful ? { encoding: "ranges", data: ranges, length: input.length } : { encoding: "raw", data: input as number[], length: input.length };
  indicesCache.set(input, { area, packed });
  return packed;
}

function decodeIndices(input: unknown, area: number): number[] {
  if (!object(input) || !Array.isArray(input.data)) invalid();
  const size = length(input.length, area);
  if (input.data.length > size) invalid();
  if (input.encoding === "raw") {
    if (input.data.length !== size || input.data.some((index) => !Number.isInteger(index) || index < 0 || index >= area)) invalid();
    return input.data as number[];
  }
  if (input.encoding !== "ranges" || input.data.length % 2 !== 0) invalid();
  let total = 0;
  for (let i = 0; i < input.data.length; i += 2) {
    const start = input.data[i], count = input.data[i + 1];
    if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 1 || start + count > area || count > size - total) invalid();
    total += count;
  }
  if (total !== size) invalid();
  const indices = new Array<number>(size);
  let at = 0;
  for (let i = 0; i < input.data.length; i += 2) for (let n = 0; n < input.data[i + 1]; n++) indices[at++] = input.data[i] + n;
  return indices;
}

/** Only the Jinchi shape is packed; no player-specific field is shared or removed. */
export function packJinchiMatch(match: MatchView): MatchView {
  const game = match.game;
  if (!envelope(game) || !Array.isArray(game.cells) || !Array.isArray(game.bases) || !Array.isArray(game.rules.map.rows)) return match;
  const { width, height, area } = dimensions(game, game.rules.map);
  if (game.cells.length !== area || game.bases.length !== area) invalid();
  const last = game.lastMove;
  if (last !== null && last !== undefined && (!object(last) || !Array.isArray(last.indices) || !Array.isArray(last.captured))) invalid();
  return { ...match, game: {
    ...game, cells: encodeGrid(game.cells), bases: encodeGrid(game.bases),
    rules: { ...game.rules, map: { ...game.rules.map, rows: encodeRows(game.rules.map.rows, width, height) } },
    ...(object(last) ? { lastMove: { ...last, indices: encodeIndices(last.indices as number[], area), captured: encodeIndices(last.captured as number[], area) } } : {}),
  } };
}

interface GridMemo<T> { encoding: string; data: string; length: number; value: T; width?: number }
/** One decoder per subscription. Memoization is limited to its latest immutable arrays. */
export function createJinchiDecoder(): (match: MatchView) => MatchView {
  let cellsMemo: GridMemo<number[]> | undefined, basesMemo: GridMemo<number[]> | undefined, rowsMemo: GridMemo<string[]> | undefined;
  const grid = (input: unknown, area: number, memo: GridMemo<number[]> | undefined): GridMemo<number[]> => {
    const packed = checkedGrid(input, area);
    return memo?.encoding === packed.encoding && memo.data === packed.data && memo.length === area ? memo : { ...packed, value: decodeGrid(packed, area) };
  };
  return (match) => {
    const game = match.game;
    if (!envelope(game) || (Array.isArray(game.cells) && Array.isArray(game.bases) && Array.isArray(game.rules.map.rows))) return match;
    const { width, area } = dimensions(game, game.rules.map);
    const cells = grid(game.cells, area, cellsMemo), bases = grid(game.bases, area, basesMemo);
    const packedRows = checkedGrid(game.rules.map.rows, area);
    let rows = rowsMemo;
    if (!rows || rows.encoding !== packedRows.encoding || rows.data !== packedRows.data || rows.length !== area || rows.width !== width) {
      let raw: string;
      if (packedRows.encoding === "raw") raw = packedRows.data;
      else {
        const chunks: string[] = [];
        walkRuns(packedRows.data, area, (value, from, to) => chunks.push(SYMBOLS[value + 2]!.repeat(to - from)));
        raw = chunks.join("");
      }
      const value: string[] = [];
      for (let i = 0; i < area; i += width) value.push(raw.slice(i, i + width));
      rows = { ...packedRows, width, value };
    }
    const last = game.lastMove;
    if (last !== null && last !== undefined && !object(last)) invalid();
    const lastMove = object(last) ? { ...last, indices: decodeIndices(last.indices, area), captured: decodeIndices(last.captured, area) } : last;
    cellsMemo = cells; basesMemo = bases; rowsMemo = rows;
    return { ...match, game: { ...game, cells: cells.value, bases: bases.value, rules: { ...game.rules, map: { ...game.rules.map, rows: rows.value } }, ...(last !== undefined ? { lastMove } : {}) } };
  };
}
