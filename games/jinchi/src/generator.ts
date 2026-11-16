import { createRng, type ConfigIssue } from '@asobiba/sdk';
import { z } from 'zod';
import { analyzeMap, insideShape, type MapAnalysis } from './balance';
import { rulesSchema, type JinchiRules } from './rules';

const die = z.int().min(2).max(100);
export const generationSchema = z.strictObject({
  width: z.int().min(3).max(1000).optional(),
  height: z.int().min(3).max(1000).optional(),
  radius: z.int().min(1).max(499).optional().describe('Круг: радиус R даёт (2R+1)×(2R+1); не сочетайте с другими размерами'),
  shape: z.enum(['rectangle', 'circle']).default('circle'),
  players: z.int().min(2).max(8),
  seed: z.int().min(0).max(2_147_483_647).default(1),
  dice: z.tuple([die, die]).default([6, 6]),
  wallDensity: z.number().min(0).max(45).default(20),
  structures: z.array(z.enum(['lakes', 'ridges', 'fortresses', 'narrows'])).min(1).max(4).default(['lakes', 'ridges']),
  balanced: z.boolean().default(true),
  flags: z.strictObject({
    mode: z.enum(['off', 'primary', 'bonus']).default('off'),
    count: z.int().min(1).max(1000).optional(),
    value: z.int().min(1).max(100_000).default(25),
    target: z.int().min(0).max(1000).default(0),
  }).prefault({}),
  effects: z.strictObject({ count: z.int().min(0).max(1000).optional() }).prefault({}),
}).superRefine((request, context) => {
  if (request.radius !== undefined && (request.width !== undefined || request.height !== undefined || request.shape !== 'circle')) context.addIssue({ code: 'custom', path: ['radius'], message: 'Радиус задаёт круг без отдельных width/height' });
  if (request.shape === 'circle' && request.width !== undefined && request.height !== undefined && request.width !== request.height) context.addIssue({ code: 'custom', path: ['height'], message: 'Для круга ширина и высота должны совпадать' });
  const count = request.flags.count ?? request.players * 3;
  if (request.flags.mode !== 'primary' && request.flags.target !== 0) context.addIssue({ code: 'custom', path: ['flags', 'target'], message: 'Цель по захватам действует только в главном режиме флагов' });
  if (request.flags.target > count) context.addIssue({ code: 'custom', path: ['flags', 'target'], message: 'Цель превышает число флагов' });
});

export type GenerationRequest = z.input<typeof generationSchema>;
type Request = z.output<typeof generationSchema>;

export interface GeneratedMap {
  map: JinchiRules['map'];
  flags: JinchiRules['flags'];
  effects: JinchiRules['effects'];
  diagnostics: MapAnalysis;
}

export class GenerationError extends Error {
  readonly issues: ConfigIssue[];
  readonly suggestions: string[];
  constructor(message: string, issues: ConfigIssue[] = []) {
    super(message);
    this.name = 'GenerationError';
    this.issues = issues;
    this.suggestions = ['Увеличьте карту или уменьшите кубики', 'Уменьшите плотность стен или измените их рисунок', 'Попробуйте другое зерно; для намеренной асимметрии выключите баланс'];
  }
}

// Odd compositions need modestly unequal polar angles on a square grid. These
// layouts keep both neighbouring fronts and paths to the centre comparable in L1.
const ODD_LAYOUTS: Record<number, [number, number][]> = {
  5: [[.696095, .768684], [-.58311, .852139], [-.959766, -.368185], [-.212261, -1.114743], [.943618, -.512488]],
  7: [[.662869, .517617], [.08455, 1.119131], [-.593805, .629279], [-1.044348, -.126558], [-.463324, -.668083], [.460463, -.830392], [1.004678, -.181508]],
};

type Point = { x: number; y: number };
function basePoints(width: number, height: number, players: number, phase: number): Point[] {
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  const rx = Math.max(2, (Math.min(width, height) - 1) * .23), ry = rx;
  const template = ODD_LAYOUTS[players];
  const angle = players === 3 || players === 6 ? Math.PI / 12 : players === 8 ? Math.PI / 8 : 0;
  const points = Array.from({ length: players }, (_, seat) => {
    const [u, v] = template?.[seat] ?? [Math.cos(angle + seat * 2 * Math.PI / players), Math.sin(angle + seat * 2 * Math.PI / players)];
    const x = u! * Math.cos(phase) - v! * Math.sin(phase), y = u! * Math.sin(phase) + v! * Math.cos(phase);
    return { x: Math.round(cx + x * rx - .5), y: Math.round(cy + y * ry - .5) };
  });
  // Rounding must not turn a 13.4% continuous difference into a failing 16% one.
  const centerDistances = points.map(point => Math.abs(point.x + .5 - cx) + Math.abs(point.y + .5 - cy));
  const maximum = Math.floor(Math.min(...centerDistances) / .87);
  for (const point of points) {
    while (Math.abs(point.x + .5 - cx) + Math.abs(point.y + .5 - cy) > maximum) {
      if (Math.abs(point.x + .5 - cx) >= Math.abs(point.y + .5 - cy)) point.x += point.x + .5 < cx ? 1 : -1;
      else point.y += point.y + .5 < cy ? 1 : -1;
    }
  }
  const violation = (layout: Point[]) => {
    const groups = [layout.map(point => Math.max(0, Math.abs(point.x + .5 - cx) - .5) + Math.max(0, Math.abs(point.y + .5 - cy) - .5))];
    const neighbors = layout.map((point, i) => layout.filter((_, j) => i !== j).map(other => Math.max(0, Math.abs(point.x - other.x) - 1) + Math.max(0, Math.abs(point.y - other.y) - 1)).sort((a, b) => a - b));
    for (let k = 0; k < Math.min(2, players - 1); k++) groups.push(neighbors.map(group => group[k]!));
    return groups.reduce((total, group) => total + Math.max(0, Math.max(...group) - Math.min(...group) - Math.max(2, Math.max(...group) * .15)), 0);
  };
  if (violation(points) === 0) return points;
  // Tiny layouts are particularly sensitive to two-cell bases. Search integer
  // neighbours instead of weakening the same path limits used by diagnostics.
  const origin = points.map(point => ({ ...point }));
  const cost = (layout: Point[]) => violation(layout) + layout.reduce((sum, point, i) => sum + (point.x - origin[i]!.x) ** 2 + (point.y - origin[i]!.y) ** 2, 0) * .0001;
  let beam = [points];
  for (let depth = 0; depth < 8; depth++) {
    const candidates = new Map<string, Point[]>();
    for (const layout of beam) for (let seat = 0; seat < players; seat++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = layout.map(point => ({ ...point }));
      next[seat]!.x += dx!; next[seat]!.y += dy!;
      if (next.some(point => point.x < 1 || point.y < 1 || point.x + 2 >= width || point.y + 2 >= height)) continue;
      if (next.some((point, i) => next.some((other, j) => i !== j && Math.abs(point.x - other.x) < 3 && Math.abs(point.y - other.y) < 3))) continue;
      candidates.set(next.map(point => `${point.x}:${point.y}`).join(','), next);
    }
    beam = [...candidates.values()].sort((a, b) => cost(a) - cost(b)).slice(0, 32);
    if (!beam.length) return points;
    if (violation(beam[0]!) === 0) return beam[0]!;
  }
  return beam[0] ?? points;
}

function reserveLine(mask: Uint8Array, width: number, height: number, from: Point, to: Point, thickness: number): void {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
  const radius = Math.max(1, thickness / 2);
  for (let step = 0; step <= steps; step++) {
    const x = from.x + (to.x - from.x) * step / steps;
    const y = from.y + (to.y - from.y) * step / steps;
    for (let py = Math.max(0, Math.floor(y - radius)); py <= Math.min(height - 1, Math.ceil(y + radius)); py++) {
      for (let px = Math.max(0, Math.floor(x - radius)); px <= Math.min(width - 1, Math.ceil(x + radius)); px++) {
        if ((px - x) ** 2 + (py - y) ** 2 <= radius ** 2 + .5) mask[py * width + px] = 1;
      }
    }
  }
}

function reserveOpening(cells: string[], mask: Uint8Array, width: number, height: number, base: Point, dice: [number, number]): boolean {
  const candidates: { x: number; y: number; w: number; h: number; distance: number }[] = [];
  for (const [w, h] of [dice, [dice[1], dice[0]]]) {
    for (const offset of [0, -Math.floor((h! - 2) / 2), 2 - h!]) {
      for (const x of [base.x + 2, base.x - w!]) candidates.push({ x, y: base.y + offset, w: w!, h: h!, distance: 0 });
    }
    for (const offset of [0, -Math.floor((w! - 2) / 2), 2 - w!]) {
      for (const y of [base.y + 2, base.y - h!]) candidates.push({ x: base.x + offset, y, w: w!, h: h!, distance: 0 });
    }
  }
  for (const candidate of candidates) candidate.distance = (candidate.x + candidate.w / 2 - width / 2) ** 2 + (candidate.y + candidate.h / 2 - height / 2) ** 2;
  candidates.sort((a, b) => a.distance - b.distance);
  for (const { x, y, w, h } of candidates) {
    if (x < 0 || y < 0 || x + w > width || y + h > height) continue;
    let valid = true;
    for (let dy = 0; dy < h && valid; dy++) for (let dx = 0; dx < w; dx++) if (cells[(y + dy) * width + x + dx] !== '.') { valid = false; break; }
    if (!valid) continue;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) mask[(y + dy) * width + x + dx] = 1;
    return true;
  }
  return false;
}

function addWalls(cells: string[], reserved: Uint8Array, width: number, height: number, starts: Point[], request: Request, seed: number): boolean {
  const rng = createRng(seed);
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  const scale = Math.min(width, height) / 2;
  const phase = rng.next() * 2 * Math.PI;
  const wave = rng.next() * 6.28;
  const scores = new Uint16Array(cells.length);
  const counts = new Int32Array(4096);
  let inside = 0, candidates = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (!insideShape(x, y, width, height, request.shape)) continue;
    if (!/^[1-8]$/.test(cells[index]!)) cells[index] = '.';
    inside++;
    if (reserved[index] || cells[index] !== '.') continue;
    const nx = (x - cx) / scale, ny = (y - cy) / scale;
    const r = Math.hypot(nx, ny);
    const theta = Math.atan2(ny, nx);
    const repeated = theta * request.players + phase;
    let score = -3;
    for (const structure of request.structures) {
      if (structure === 'lakes') score = Math.max(score, Math.cos(r * 15 + wave) + Math.cos(repeated * 2) * .65);
      if (structure === 'ridges') score = Math.max(score, Math.cos(r * 23 + Math.sin(repeated) * .9 + wave) + Math.cos(repeated * 3) * .3);
      if (structure === 'narrows') score = Math.max(score, Math.cos(repeated) + Math.cos(r * 18 + wave) * .7);
      if (structure === 'fortresses') {
        let nearest = Infinity;
        for (const start of starts) nearest = Math.min(nearest, Math.hypot(x - start.x - .5, y - start.y - .5) / Math.max(...request.dice));
        score = Math.max(score, Math.cos(nearest * 2.6 + wave) + Math.cos(repeated * 2) * .25);
      }
    }
    const bin = Math.max(0, Math.min(4095, Math.floor((score + 3) / 6 * 4095)));
    scores[index] = bin + 1;
    counts[bin] = counts[bin]! + 1;
    candidates++;
  }
  const wanted = Math.round(inside * request.wallDensity / 100);
  if (wanted > candidates) return false;
  let remaining = wanted, threshold = 4095;
  while (threshold > 0 && remaining > counts[threshold]!) { remaining -= counts[threshold]!; threshold--; }
  for (let i = 0; i < cells.length; i++) {
    const bin = scores[i]! - 1;
    if (bin > threshold || (bin === threshold && remaining-- > 0)) cells[i] = '#';
  }
  return true;
}

/** Preserve free islands and join them by actual passages, then reallocate the
 * requested wall count elsewhere. A retry never silently changes the density. */
function reserveConnections(cells: string[], reserved: Uint8Array, width: number, height: number, request: Request): boolean {
  const reachable = new Uint8Array(cells.length);
  const queue = new Int32Array(cells.length);
  let head = 0, tail = 0;
  for (let i = 0; i < cells.length; i++) if (/^[1-8]$/.test(cells[i]!)) { queue[tail++] = i; reachable[i] = 1; }
  const neighbors = (index: number, visit: (next: number) => void) => {
    const x = index % width, y = Math.floor(index / width);
    if (x > 0) visit(index - 1);
    if (x + 1 < width) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y + 1 < height) visit(index + width);
  };
  while (head < tail) neighbors(queue[head++]!, next => {
    if (!reachable[next] && cells[next] !== '#') { reachable[next] = 1; queue[tail++] = next; }
  });
  let changed = false;
  const handled = new Uint8Array(cells.length);
  for (let first = 0; first < cells.length; first++) {
    if (cells[first] !== '.' || reachable[first] || handled[first]) continue;
    head = 0; tail = 1; queue[0] = first; handled[first] = 1;
    while (head < tail) neighbors(queue[head++]!, next => {
      if (!handled[next] && !reachable[next] && cells[next] === '.') { handled[next] = 1; queue[tail++] = next; }
    });
    const component = queue.slice(0, tail);
    for (const index of component) reserved[index] = 1;
    const previous = new Int32Array(cells.length).fill(-2);
    head = 0; tail = 0;
    for (const index of component) { queue[tail++] = index; previous[index] = -1; }
    let connection = -1;
    while (head < tail && connection < 0) {
      const index = queue[head++]!;
      neighbors(index, next => {
        if (previous[next] !== -2 || !insideShape(next % width, Math.floor(next / width), width, height, request.shape)) return;
        previous[next] = index;
        if (reachable[next]) { connection = next; return; }
        queue[tail++] = next;
      });
    }
    if (connection < 0) continue;
    for (let index = connection; index >= 0; index = previous[index]!) {
      reserveLine(reserved, width, height, { x: index % width, y: Math.floor(index / width) }, { x: index % width, y: Math.floor(index / width) }, Math.min(...request.dice));
    }
    for (const index of component) reachable[index] = 1;
    changed = true;
  }
  return changed;
}

function placeNear(cells: string[], occupied: Set<number>, width: number, height: number, point: Point): Point | null {
  const x = Math.round(point.x), y = Math.round(point.y);
  for (let radius = 0; radius <= Math.max(width, height); radius++) {
    for (let dy = -radius; dy <= radius; dy++) for (const dx of radius === 0 ? [0] : [-radius, radius]) {
      const px = x + dx, py = y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const index = py * width + px;
      if (cells[index] === '.' && !occupied.has(index)) { occupied.add(index); return { x: px, y: py }; }
    }
    for (let dx = -radius + 1; dx < radius; dx++) for (const dy of [-radius, radius]) {
      const px = x + dx, py = y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const index = py * width + px;
      if (cells[index] === '.' && !occupied.has(index)) { occupied.add(index); return { x: px, y: py }; }
    }
  }
  return null;
}

function build(request: Request, width: number, height: number, attempt: number): GeneratedMap | null {
  const seed = (request.seed + attempt * 7919) >>> 0;
  const cells = new Array<string>(width * height);
  const reserved = new Uint8Array(cells.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells[y * width + x] = insideShape(x, y, width, height, request.shape) ? '.' : '#';
  const phase = (seed % 4) * Math.PI / 2;
  const starts = basePoints(width, height, request.players, phase);
  for (let seat = 0; seat < starts.length; seat++) {
    const point = starts[seat]!;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const x = point.x + dx, y = point.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height || cells[y * width + x] !== '.') return null;
      cells[y * width + x] = String(seat + 1); reserved[y * width + x] = 1;
    }
  }
  const center = { x: (width - 1) / 2, y: (height - 1) / 2 };
  for (const point of starts) {
    if (request.balanced && !reserveOpening(cells, reserved, width, height, point, request.dice)) return null;
    const start = { x: point.x + .5, y: point.y + .5 };
    const dx = center.x - start.x, dy = center.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const bend = Math.max(2, Math.max(...request.dice) * .7);
    const intermediate = { x: (start.x + center.x) / 2 - dy / length * bend, y: (start.y + center.y) / 2 + dx / length * bend };
    reserveLine(reserved, width, height, start, center, Math.max(...request.dice) + 1);
    reserveLine(reserved, width, height, start, intermediate, Math.max(...request.dice) + 1);
    reserveLine(reserved, width, height, intermediate, center, Math.max(...request.dice) + 1);
  }
  // Retain the explicit extremities of odd-diameter circles in their overview.
  if (request.shape === 'circle' && width % 2 === 1) for (const [x, y] of [[center.x, 0], [center.x, height - 1], [0, center.y], [width - 1, center.y]]) reserved[y! * width + x!] = 1;
  for (let pass = 0; pass < 4; pass++) {
    if (!addWalls(cells, reserved, width, height, starts, request, seed)) return null;
    if (!request.balanced || !reserveConnections(cells, reserved, width, height, request)) break;
  }
  const occupied = new Set<number>();
  const flags: JinchiRules['flags'] = { mode: request.flags.mode, value: request.flags.value, target: request.flags.target, positions: [] };
  const effects: JinchiRules['effects'] = { cells: [], mysteryPool: [{ kind: 'cache', value: 25, weight: 35 }, { kind: 'trap', value: 15, weight: 20 }, { kind: 'reroll', weight: 30 }, { kind: 'lock', weight: 15 }] };
  const objectPoint = (index: number, count: number, forEffects: boolean): Point => {
    const seat = index % request.players, tier = Math.floor(index / request.players);
    const base = starts[seat]!;
    let angle = Math.atan2(base.y + .5 - center.y, base.x + .5 - center.x);
    let radius = Math.hypot(base.x + .5 - center.x, base.y + .5 - center.y);
    if (forEffects) radius *= tier === 0 ? .72 : tier === 1 ? .38 : .2;
    else { radius *= tier % 3 === 0 ? .5 : tier % 3 === 1 ? .65 : .2; if (tier % 3 === 1) angle += Math.PI / request.players; }
    if (count < request.players) radius = 0;
    if (tier >= 3) { angle += (tier - 2) * .618; radius = Math.min(width, height) * (.1 + (tier % 7) * .045); }
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  };
  const flagCount = request.flags.mode === 'off' ? 0 : request.flags.count ?? request.players * 3;
  for (let i = 0; i < flagCount; i++) {
    const point = placeNear(cells, occupied, width, height, objectPoint(i, flagCount, false));
    if (!point) return null;
    flags.positions.push(point);
  }
  const effectCount = request.effects.count ?? request.players * 3;
  for (let i = 0; i < effectCount; i++) {
    const point = placeNear(cells, occupied, width, height, objectPoint(i, effectCount, true));
    if (!point) return null;
    effects.cells.push({ ...point, kind: i < request.players ? 'reroll' : 'mystery' });
  }
  const rows = Array.from({ length: height }, (_, y) => cells.slice(y * width, (y + 1) * width).join(''));
  const map = { width, height, rows, expectedPlayers: request.balanced ? request.players : undefined, generation: { version: 1 as const, seed: request.seed, players: request.players, balanced: request.balanced, shape: request.shape, wallDensity: request.wallDensity } };
  const rules = rulesSchema.parse({ map, dice: { sides: request.dice[0] === request.dice[1] ? request.dice[0] : request.dice }, flags, effects });
  return { map: rules.map, flags: rules.flags, effects: rules.effects, diagnostics: analyzeMap(rules) };
}

/** One data-only generation contract is shared by MCP, the website and presets. */
export function generateMap(input: GenerationRequest): GeneratedMap {
  const request = generationSchema.parse(input);
  const defaultSide = Math.max(25, request.players * 12 + 1);
  const width = request.radius !== undefined ? request.radius * 2 + 1 : request.width ?? request.height ?? defaultSide;
  const height = request.radius !== undefined ? request.radius * 2 + 1 : request.height ?? request.width ?? defaultSide;
  if (request.balanced && (Math.min(...request.dice) > Math.min(width, height) || request.dice[0] * request.dice[1] + request.players * 4 > width * height)) throw new GenerationError('Кубики и стартовые зоны не помещаются на этой карте');
  let last: GeneratedMap | null = null;
  const attempts = width * height > 200_000 ? 6 : 24;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const generated = build(request, width, height, attempt);
    if (!generated) continue;
    last = generated;
    if (!request.balanced || generated.diagnostics.balanced) return generated;
  }
  throw new GenerationError('Не удалось построить карту с заявленными условиями баланса. Параметры не изменены.', last?.diagnostics.issues ?? []);
}
