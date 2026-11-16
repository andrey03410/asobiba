import { EMPTY, WALL, type JinchiRules } from './rules';
import { CORNERS, SIDES } from './placement';

export interface CaptureBoard { width: number; height: number; cells: number[]; bases: number[]; rules: JinchiRules }

/** Mutates only the caller-owned cells copy; bases/rules remain immutable. */
export function captureTerritory(state: CaptureBoard, seat: number): { captured: number[]; enemies: number } {
  const { width, height, cells, rules } = state;
  const labels = new Int32Array(cells.length);
  const queue = new Int32Array(cells.length);
  const neighbors = rules.capture.diagonal ? SIDES : CORNERS;
  const sizes: number[] = [0];
  const touches: boolean[] = [false];
  const edges: boolean[] = [false];
  let largest = 0;
  for (let i = 0; i < cells.length; i++) {
    if (labels[i] || cells[i] === seat || (rules.capture.walls && cells[i] === WALL)) continue;
    const label = sizes.length;
    let head = 0, tail = 1, touching = false, edge = false;
    queue[0] = i;
    labels[i] = label;
    while (head < tail) {
      const index = queue[head++]!;
      const x = index % width, y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (cells[ni] === seat) touching = true;
        else if (!labels[ni] && (!rules.capture.walls || cells[ni] !== WALL)) { labels[ni] = label; queue[tail++] = ni; }
      }
    }
    sizes.push(tail); touches.push(touching); edges.push(edge);
    if (touching && tail > largest) largest = tail;
  }
  const captured: number[] = [];
  let enemies = 0;
  for (let index = 0; index < cells.length; index++) {
    const label = labels[index]!;
    if (!label || !touches[label] || (rules.capture.walls ? sizes[label] === largest : edges[label])) continue;
    const owner = cells[index]!;
    if (owner === WALL || owner === seat) continue;
    if (owner >= 0 && (rules.capture.opponents === 'none' || (rules.capture.opponents === 'except-starts' && state.bases[index] !== EMPTY))) continue;
    if (owner >= 0) enemies++;
    cells[index] = seat;
    captured.push(index);
  }
  return { captured, enemies };
}
