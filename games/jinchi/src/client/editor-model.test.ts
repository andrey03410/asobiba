import { describe, expect, it } from 'vitest';
import { resizeMap, paintMap, floodMap, historyStep, type MapData } from './editor-model';

const map: MapData = { width: 3, height: 3, rows: ['1..', '.#.', '..2'] };
describe('map editor operations', () => {
  it('preserves the upper left intersection when resizing', () => {
    expect(resizeMap(map, 4, 3).rows).toEqual(['1...', '.#..', '..2.']);
    expect(resizeMap(map, 3, 4).rows).toEqual(['1..', '.#.', '..2', '...']);
    expect(resizeMap(map, 999, -1)).toMatchObject({ width: 200, height: 3 });
  });
  it('mirrors bases with successive numbers without overwriting a central cell', () => {
    const blank = { width: 5, height: 5, rows: Array(5).fill('.....') };
    expect(paintMap(blank, [[0, 0]], '1', 'quarters').rows).toEqual(['1...2', '.....', '.....', '.....', '3...4']);
    expect(paintMap(blank, [[2, 2]], '1', 'quarters').rows[2]).toBe('..1..');
  });
  it('fills only the connected area and keeps walls and bases', () => {
    const divided = { width: 5, height: 3, rows: ['..#..', '..#12', '..#..'] };
    expect(floodMap(divided, 0, 0, '#', 'off').rows).toEqual(['###..', '###12', '###..']);
    expect(divided.rows[0]).toBe('..#..');
  });
  it('clips out of bounds strokes and paints a rotating reflected base', () => {
    expect(paintMap(map, [[-1, 0], [3, 2], [0, 2]], '3', 'rotate').rows).toEqual(['1.4', '.#.', '3.2']);
  });
  it('undoes a complete gesture and clears redo after a new edit', () => {
    const next = paintMap(map, [[1, 0], [2, 0]], '#', 'off');
    let h = historyStep({ past: [], present: map, future: [] }, { type: 'commit', map: next });
    h = historyStep(h, { type: 'undo' });
    expect(h.present.rows).toEqual(['1..', '.#.', '..2']);
    expect(historyStep(h, { type: 'redo' }).present.rows).toEqual(['1##', '.#.', '..2']);
    h = historyStep(h, { type: 'commit', map: resizeMap(map, 4, 3) });
    expect(h.future).toEqual([]);
  });
});
