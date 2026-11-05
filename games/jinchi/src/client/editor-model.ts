export interface MapData { width: number; height: number; rows: string[] }
export type Symmetry = 'off' | 'horizontal' | 'vertical' | 'quarters' | 'rotate';
export interface EditorHistory { past: MapData[]; present: MapData; future: MapData[] }

export function resizeMap(map: MapData, width: number, height: number): MapData {
  const w = Math.max(3, Math.min(200, Math.round(Number.isFinite(width) ? width : 3)));
  const h = Math.max(3, Math.min(200, Math.round(Number.isFinite(height) ? height : 3)));
  return { width: w, height: h, rows: Array.from({ length: h }, (_, y) => (map.rows[y] ?? '').padEnd(w, '.').slice(0, w)) };
}

export function paintMap(map: MapData, points: [number, number][], material: string, symmetry: Symmetry): MapData {
  const rows = map.rows.map(row => [...row]);
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
      rows[my]![mx] = cell;
    });
  }
  return { ...map, rows: rows.map(row => row.join('')) };
}

export function floodMap(map: MapData, x: number, y: number, material: string, symmetry: Symmetry): MapData {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return map;
  const target = map.rows[y]?.[x];
  if (!target || (target === material && symmetry === 'off')) return map;
  const visited = new Uint8Array(map.width * map.height);
  const queue: [number, number][] = [[x, y]];
  visited[y * map.width + x] = 1;
  for (let q = 0; q < queue.length; q++) {
    const [cx, cy] = queue[q]!;
    for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
      if (nx! < 0 || ny! < 0 || nx! >= map.width || ny! >= map.height) continue;
      const index = ny! * map.width + nx!;
      if (!visited[index] && map.rows[ny!]?.[nx!] === target) {
        visited[index] = 1;
        queue.push([nx!, ny!]);
      }
    }
  }
  return paintMap(map, queue, material, symmetry);
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
  if (JSON.stringify(action.map) === JSON.stringify(history.present)) return history;
  return { past: [...history.past.slice(-49), history.present], present: action.map, future: [] };
}

/** Interpolate a brush gesture, including fast pointer movements over several cells. */
export function strokePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  return Array.from({ length: steps + 1 }, (_, i) => [Math.round(x0 + (x1 - x0) * i / (steps || 1)), Math.round(y0 + (y1 - y0) * i / (steps || 1))]);
}
