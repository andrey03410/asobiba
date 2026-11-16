import type { ConfigIssue } from '@asobiba/sdk';
import { captureTerritory } from './capture';
import { placementCapacity } from './placement';
import type { JinchiRules } from './rules';

export interface BaseAnalysis {
  id: number;
  area: number;
  allRollsFit: boolean;
  exits: number;
  localArea: number;
  reachableArea: number;
  centerDistance: number;
  neighborDistances: number[];
  flagDistance: number | null;
  effectDistance: number | null;
  firstCapture: number;
}

export interface MapAnalysis {
  balanced: boolean;
  playableArea: number;
  wallPercent: number;
  unreachableArea: number;
  bases: BaseAnalysis[];
  issues: ConfigIssue[];
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
// Each undirected side/corner contact is checked once while reading cells in row order.
const PREVIOUS_START_NEIGHBORS = [[-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const analysisCache = new WeakMap<JinchiRules, MapAnalysis>();

export function insideShape(x: number, y: number, width: number, height: number, shape: 'rectangle' | 'circle'): boolean {
  if (shape === 'rectangle') return true;
  const rx = (width - 1) / 2;
  const ry = (height - 1) / 2;
  return rx > 0 && ry > 0 && ((x - rx) / rx) ** 2 + ((y - ry) / ry) ** 2 <= 1 + 1e-10;
}

function distances(cells: number[], width: number, height: number, starts: number[], seat: number, forbidden?: Uint8Array, stopOutside?: { x: number; y: number; radius: number }): { values: Int32Array; path: number[]; reachable: number } {
  const values = new Int32Array(cells.length).fill(-1);
  const previous = stopOutside ? new Int32Array(cells.length).fill(-1) : null;
  const queue = new Int32Array(cells.length);
  let head = 0, tail = 0, reachable = 0;
  for (const index of starts) { values[index] = 0; queue[tail++] = index; }
  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width, y = Math.floor(index / width);
    reachable++;
    if (stopOutside && Math.max(Math.abs(x - stopOutside.x), Math.abs(y - stopOutside.y)) > stopOutside.radius) {
      const path: number[] = [];
      for (let i = index; i >= 0; i = previous![i]!) path.push(i);
      return { values, path, reachable };
    }
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (values[next] !== -1 || cells[next] === -2 || (cells[next]! >= 0 && cells[next] !== seat) || forbidden?.[next]) continue;
      values[next] = values[index]! + 1;
      if (previous) previous[next] = index;
      queue[tail++] = next;
    }
  }
  return { values, path: [], reachable };
}

function independentExits(cells: number[], width: number, height: number, starts: number[], seat: number, radius: number): number {
  const center = starts.reduce((sum, i) => ({ x: sum.x + i % width, y: sum.y + Math.floor(i / width) }), { x: 0, y: 0 });
  center.x /= starts.length; center.y /= starts.length;
  const boundary = { ...center, radius };
  const first = distances(cells, width, height, starts, seat, undefined, boundary);
  if (!first.path.length) return 0;
  const forbidden = new Uint8Array(cells.length);
  for (const i of first.path) if (cells[i] !== seat) forbidden[i] = 1;
  return distances(cells, width, height, starts, seat, forbidden, boundary).path.length ? 2 : 1;
}

function nearestDistance(values: Int32Array, positions: { x: number; y: number }[], width: number): number | null {
  if (!positions.length) return null;
  let best = Infinity;
  for (const point of positions) {
    const distance = values[point.y * width + point.x];
    if (distance !== undefined && distance >= 0) best = Math.min(best, distance);
  }
  return Number.isFinite(best) ? best : -1;
}

/** Probe actual legal opening rectangles; the shared capture implementation is the judge. */
function openingCapture(cells: number[], bases: number[], rules: JinchiRules, seat: number, start: number[], sides: [number, number]): number {
  const { width, height } = rules.map;
  let best = 0, probes = 0;
  const first = start[0]!;
  const bx = first % width, by = Math.floor(first / width);
  const sizes: [number, number][] = [[sides[0], sides[1]], [1, 1]];
  for (const [w, h] of sizes) {
    for (const [x, y] of [[bx + 2, by], [bx - w, by], [bx, by + 2], [bx, by - h]]) {
      if (x! < 0 || y! < 0 || x! + w > width || y! + h > height) continue;
      let valid = true;
      for (let dy = 0; dy < h && valid; dy++) for (let dx = 0; dx < w; dx++) if (cells[(y! + dy) * width + x! + dx] !== -1) { valid = false; break; }
      if (!valid) continue;
      const copy = [...cells];
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) copy[(y! + dy) * width + x! + dx] = seat;
      best = Math.max(best, captureTerritory({ width, height, cells: copy, bases, rules }, seat).captured.length);
      if (++probes >= (cells.length > 200_000 ? 2 : 8)) return best;
    }
  }
  return best;
}

/** Geometric evidence, deliberately separate from win rates of random simulations. */
export function analyzeMap(rules: JinchiRules): MapAnalysis {
  const cached = analysisCache.get(rules);
  if (cached) return cached;
  const { width, height, rows, generation } = rules.map;
  const issues: ConfigIssue[] = [];
  const severity = generation?.balanced ? 'error' as const : 'warning' as const;
  const issue = (code: string, message: string, hint: string) => issues.push({ path: 'map', code, message, hint, severity });
  if (rows.length !== height || rows.some(row => row.length !== width)) {
    return { balanced: false, playableArea: 0, wallPercent: 0, unreachableArea: 0, bases: [], issues: [{ path: 'map.rows', code: 'balance-shape', message: 'Сначала исправьте размеры строк карты', severity: 'error' }] };
  }
  const cells = new Array<number>(width * height);
  const starts = new Map<number, number[]>();
  const touchingStarts = new Set<string>();
  let playableArea = 0, interior = 0, walls = 0;
  const shape = generation?.shape ?? 'rectangle';
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const char = rows[y]![x]!;
    const index = y * width + x;
    const value = char === '#' ? -2 : char === '.' ? -1 : Number(char) - 1;
    cells[index] = value;
    if (value !== -2) playableArea++;
    if (insideShape(x, y, width, height, shape)) { interior++; if (value === -2) walls++; }
    if (value >= 0) {
      const list = starts.get(value) ?? []; list.push(index); starts.set(value, list);
      for (const [dx, dy] of PREVIOUS_START_NEIGHBORS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width) continue;
        const other = cells[ny * width + nx]!;
        if (other >= 0 && other !== value) touchingStarts.add(`${Math.min(value, other) + 1}:${Math.max(value, other) + 1}`);
      }
    }
  }
  if (touchingStarts.size) issue('balance-starts-touch', `Стартовые зоны касаются стороной или углом: ${[...touchingStarts].join(', ')}`, 'Разделите разные базы свободными клетками или стенами; пересоберите карту под нужный состав');
  const immutableBases = cells.map(value => value >= 0 ? value : -1);
  const sides = Array.isArray(rules.dice.sides) ? rules.dice.sides : [rules.dice.sides, rules.dice.sides];
  const pair: [number, number] = [sides[0]!, sides[1]!];
  const radius = 4 * Math.max(...pair);
  let centerIndex = -1, centerSquared = Infinity;
  for (let i = 0; i < cells.length; i++) if (cells[i] === -1) {
    const squared = (i % width - (width - 1) / 2) ** 2 + (Math.floor(i / width) - (height - 1) / 2) ** 2;
    if (squared < centerSquared) { centerSquared = squared; centerIndex = i; }
  }
  const reachable = new Uint8Array(cells.length);
  const bases: BaseAnalysis[] = [];
  for (const [seat, indices] of [...starts].sort(([a], [b]) => a - b)) {
    const capacity = placementCapacity({ width, height, cells, rules }, seat);
    let allRollsFit = true;
    for (let a = 1; a <= pair[0]; a++) for (let b = 1; b <= pair[1]; b++) {
      if ((capacity[b] ?? 0) < a && (capacity[a] ?? 0) < b) allRollsFit = false;
    }
    const result = distances(cells, width, height, indices, seat);
    let localArea = 0;
    for (let i = 0; i < cells.length; i++) if (result.values[i]! >= 0) {
      reachable[i] = 1;
      if (result.values[i]! <= radius && cells[i] === -1) localArea++;
    }
    const neighborDistances: number[] = [];
    for (const [other, otherIndices] of starts) if (other !== seat) {
      let nearest = Infinity;
      for (const i of otherIndices) for (const [dx, dy] of SIDES) {
        const nx = i % width + dx, ny = Math.floor(i / width) + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const distance = result.values[ny * width + nx]!;
        if (distance >= 0) nearest = Math.min(nearest, distance + 1);
      }
      neighborDistances.push(Number.isFinite(nearest) ? nearest : -1);
    }
    neighborDistances.sort((a, b) => a - b);
    const exits = independentExits(cells, width, height, indices, seat, Math.max(...pair) + 2);
    const base: BaseAnalysis = {
      id: seat + 1, area: indices.length, allRollsFit, exits, localArea,
      reachableArea: result.reachable,
      centerDistance: centerIndex >= 0 ? result.values[centerIndex]! : -1,
      neighborDistances,
      flagDistance: nearestDistance(result.values, rules.flags.positions, width),
      effectDistance: nearestDistance(result.values, rules.effects.cells, width),
      firstCapture: openingCapture(cells, immutableBases, rules, seat, indices, pair),
    };
    bases.push(base);
    if (!allRollsFit) issue('balance-start-roll', `База ${base.id}: не каждый стартовый бросок помещается`, 'Расширьте свободную область у базы, уменьшите кубики или увеличьте карту');
    if (exits < 2) issue('balance-exits', `База ${base.id}: найдено независимых выходов — ${exits}`, 'Откройте два отдельных выхода из стартовой области');
    if (base.centerDistance < 0 || base.neighborDistances.some(value => value < 0) || base.flagDistance === -1 || base.effectDistance === -1) issue('balance-path', `База ${base.id}: часть общих целей недоступна`, 'Соедините области проходами и перенесите недоступные объекты');
  }
  let unreachableArea = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === -1 && !reachable[i]) unreachableArea++;
  if (unreachableArea) issue('balance-unreachable', `Недоступно свободных клеток: ${unreachableArea}`, 'Соедините свободные области с базами или замените их стенами');
  if (bases.length < 2) issue('balance-players', 'Нужно не меньше двух стартовых зон', 'Добавьте отдельную базу каждому игроку');
  if (new Set(bases.map(base => base.area)).size > 1) issue('balance-base-area', 'Площади стартовых зон различаются', 'Сделайте стартовые зоны одинаковой площади');
  const compare = (values: number[], tolerance: number, absolute: number, code: string, label: string) => {
    if (values.length < 2 || values.some(value => value < 0)) return;
    const max = Math.max(...values), min = Math.min(...values);
    if (max - min > Math.max(max * tolerance, absolute)) issue(code, `${label}: от ${min} до ${max}`, 'Измените зерно, расположение баз или препятствия; проверьте метрики каждой базы');
  };
  compare(bases.map(base => base.localArea), .1, 0, 'balance-local-area', 'Различается доступная стартовая площадь');
  compare(bases.map(base => base.centerDistance), .15, 2, 'balance-center', 'Различается путь в общий центр');
  for (let index = 0; index < Math.min(2, bases.length - 1); index++) compare(bases.map(base => base.neighborDistances[index]!), .15, 2, 'balance-neighbors', 'Различается путь к соседним фронтам');
  for (const [key, label] of [['flagDistance', 'флагам'], ['effectDistance', 'спецклеткам']] as const) compare(bases.flatMap(base => base[key] === null ? [] : [base[key]!]), .15, 2, `balance-${key}`, `Различается путь к ${label}`);
  compare(bases.map(base => base.firstCapture), .1, Math.max(4, playableArea * .01), 'balance-opening-capture', 'Стены дают несопоставимые первые захваты');
  if (generation?.players !== undefined && generation.players !== bases.length) issue('balance-player-count', 'Число баз не соответствует составу генерации', 'Пересоберите карту под фактическое число игроков');
  if (rules.map.expectedPlayers !== undefined && rules.map.expectedPlayers !== bases.length) issue('balance-player-count', 'Число баз не соответствует ожидаемому составу', 'Исправьте состав или пересоберите карту');
  const wallPercent = interior ? walls * 100 / interior : 0;
  if (generation && Math.abs(wallPercent - generation.wallDensity) > 2) issue('balance-density', `Плотность стен ${wallPercent.toFixed(1)} % вместо ${generation.wallDensity} %`, 'Пересоберите карту или явно измените запрос плотности');
  const analysis = { balanced: issues.length === 0, playableArea, wallPercent, unreachableArea, bases, issues };
  analysisCache.set(rules, analysis);
  return analysis;
}
