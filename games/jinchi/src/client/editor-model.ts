export interface EditorPosition { x: number; y: number }
export interface EditorEffect extends EditorPosition { kind: 'cache' | 'trap' | 'reroll' | 'lock' | 'mystery'; value?: number }
export interface MapData { width: number; height: number; rows: string[]; objects?: { flags: EditorPosition[]; effects: EditorEffect[] } }
export type Symmetry = 'off' | 'horizontal' | 'vertical' | 'quarters' | 'rotate';
export interface EditorHistory { past: MapData[]; present: MapData; future: MapData[] }
export function resizeLosses(map: MapData, width: number, height: number): { bases: number; flags: number; effects: number } {
  let bases = 0;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if ((x >= width || y >= height) && /^[1-8]$/.test(map.rows[y]?.[x] ?? '.')) bases++;
  const outside = (p: EditorPosition) => p.x >= width || p.y >= height;
  return { bases, flags: map.objects?.flags.filter(outside).length ?? 0, effects: map.objects?.effects.filter(outside).length ?? 0 };
}

export function resizeMap(map: MapData, width: number, height: number): MapData {
  const w = Math.max(3, Math.min(1000, Math.round(Number.isFinite(width) ? width : 3)));
  const h = Math.max(3, Math.min(1000, Math.round(Number.isFinite(height) ? height : 3)));
  const inside = ({ x, y }: EditorPosition) => x < w && y < h;
  return { ...map, width: w, height: h, rows: Array.from({ length: h }, (_, y) => (map.rows[y] ?? '').padEnd(w, '.').slice(0, w)), ...(map.objects ? { objects: { flags: map.objects.flags.filter(inside), effects: map.objects.effects.filter(inside) } } : {}) };
}

export function paintMap(map: MapData, points: [number, number][], material: string, symmetry: Symmetry): MapData {
  const rows = [...map.rows];
  const changed = new Map<number, string[]>();
  const blocked = new Set<number>();
  for (const [x, y] of points) {
    const mirrors: [number, number][] = [[x, y]];
    if (symmetry === 'horizontal' || symmetry === 'quarters') mirrors.push([map.width - 1 - x, y]);
    if (symmetry === 'vertical' || symmetry === 'quarters') mirrors.push([x, map.height - 1 - y]);
    if (symmetry === 'rotate' || symmetry === 'quarters') mirrors.push([map.width - 1 - x, map.height - 1 - y]);
    const seen = new Set<string>();
    mirrors.forEach(([mx, my], i) => {
      const key = `${mx},${my}`;
      if (mx < 0 || my < 0 || mx >= map.width || my >= map.height || seen.has(key)) return;
      seen.add(key);
      const cell = /^[1-8]$/.test(material) ? String((Number(material) - 1 + i) % 8 + 1) : material;
      let row = changed.get(my);
      if (!row) { row = [...rows[my]!]; changed.set(my, row); }
      row[mx] = cell;
      if (cell !== '.') blocked.add(my * map.width + mx);
    });
  }
  for (const [y, row] of changed) rows[y] = row.join('');
  const keep = ({ x, y }: EditorPosition) => !blocked.has(y * map.width + x);
  return { ...map, rows, ...(map.objects ? { objects: { flags: map.objects.flags.filter(keep), effects: map.objects.effects.filter(keep) } } : {}) };
}

export function paintObject(map: MapData, x: number, y: number, kind: 'flag' | EditorEffect['kind'] | 'erase', value?: number): MapData {
  if (map.rows[y]?.[x] !== '.') return map;
  const keep = (p: EditorPosition) => p.x !== x || p.y !== y;
  const flags = (map.objects?.flags ?? []).filter(keep);
  const effects = (map.objects?.effects ?? []).filter(keep);
  if (kind === 'flag') { if (flags.length >= 1000) return map; flags.push({ x, y }); }
  else if (kind !== 'erase') { if (effects.length >= 1000) return map; effects.push({ x, y, kind, ...((kind === 'cache' || kind === 'trap') ? { value: value ?? (kind === 'cache' ? 25 : 15) } : {}) }); }
  return { ...map, objects: { flags, effects } };
}

export function floodMap(map: MapData, x: number, y: number, material: string, symmetry: Symmetry): MapData {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return map;
  const target = map.rows[y]?.[x];
  if (!target || (target === material && symmetry === 'off')) return map;
  const visited = new Uint8Array(map.width * map.height);
  const queue = new Int32Array(map.width * map.height);
  queue[0] = y * map.width + x;
  let length = 1;
  visited[y * map.width + x] = 1;
  for (let q = 0; q < length; q++) {
    const index = queue[q]!;
    const cx = index % map.width, cy = Math.floor(index / map.width);
    for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
      if (nx! < 0 || ny! < 0 || nx! >= map.width || ny! >= map.height) continue;
      const index = ny! * map.width + nx!;
      if (!visited[index] && map.rows[ny!]?.[nx!] === target) {
        visited[index] = 1;
        queue[length++] = index;
      }
    }
  }
  const rows = [...map.rows], changed = new Map<number, string[]>();
  const blocked = map.objects && material !== '.' ? new Uint8Array(map.width * map.height) : null;
  const write = (px: number, py: number, mirror: number) => {
    let row = changed.get(py);
    if (!row) { row = [...rows[py]!]; changed.set(py, row); }
    row[px] = /^[1-8]$/.test(material) ? String((Number(material) - 1 + mirror) % 8 + 1) : material;
    if (blocked) blocked[py * map.width + px] = 1;
  };
  for (let i = 0; i < length; i++) {
    const index = queue[i]!;
    const px = index % map.width, py = Math.floor(index / map.width);
    const mx = map.width - 1 - px, my = map.height - 1 - py;
    write(px, py, 0);
    if ((symmetry === 'horizontal' || symmetry === 'quarters') && mx !== px) write(mx, py, 1);
    if ((symmetry === 'vertical' || symmetry === 'quarters') && my !== py) write(px, my, symmetry === 'quarters' ? 2 : 1);
    if ((symmetry === 'rotate' || symmetry === 'quarters') && (mx !== px || my !== py) && (symmetry !== 'quarters' || (mx !== px && my !== py))) write(mx, my, symmetry === 'quarters' ? 3 : 1);
  }
  for (const [y, row] of changed) rows[y] = row.join('');
  const keep = (p: EditorPosition) => !blocked?.[p.y * map.width + p.x];
  return { ...map, rows, ...(map.objects ? { objects: { flags: map.objects.flags.filter(keep), effects: map.objects.effects.filter(keep) } } : {}) };
}

export function historyStep(history: EditorHistory, action: { type: 'undo' } | { type: 'redo' } | { type: 'commit'; map: MapData }): EditorHistory {
  if (action.type === 'undo') {
    const previous = history.past.at(-1);
    return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] } : history;
  }
  if (action.type === 'redo') {
    const next = history.future[0];
    return next ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) } : history;
  }
  if (action.map.width === history.present.width && action.map.height === history.present.height && action.map.objects === history.present.objects && action.map.rows.every((row, i) => row === history.present.rows[i])) return history;
  return { past: [...history.past.slice(-49), history.present], present: action.map, future: [] };
}

/** Interpolate a brush gesture, including fast pointer movements over several cells. */
export function strokePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  return Array.from({ length: steps + 1 }, (_, i) => [Math.round(x0 + (x1 - x0) * i / (steps || 1)), Math.round(y0 + (y1 - y0) * i / (steps || 1))]);
}
