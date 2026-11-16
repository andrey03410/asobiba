import { describe, expect, it } from 'vitest';
import { resizeMap, paintMap, floodMap, historyStep, paintObject, resizeLosses, rulesFromEditorMap, type MapData } from './editor-model';
import { rulesSchema } from '../rules';

const map: MapData = { width: 3, height: 3, rows: ['1..', '.#.', '..2'] };
describe('map editor operations', () => {
  it('preserves the upper left intersection when resizing', () => {
    expect(resizeMap(map, 4, 3).rows).toEqual(['1...', '.#..', '..2.']);
    expect(resizeMap(map, 3, 4).rows).toEqual(['1..', '.#.', '..2', '...']);
    expect(resizeMap(map, 1000, -1)).toMatchObject({ width: 1000, height: 3 });
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
  it('keeps untouched rows shared when painting a million-cell map', () => {
    const rows = Array(1000).fill('.'.repeat(1000));
    const next = paintMap({ width: 1000, height: 1000, rows }, [[999, 999]], '#', 'off');
    expect(next.rows[999].at(-1)).toBe('#');
    expect(next.rows[0]).toBe(rows[0]);
    expect(rows[999].at(-1)).toBe('.');
  });
  it('clips objects on resize and restores them with undo', () => {
    const original = { width: 5, height: 3, rows: ['.....', '.....', '.....'], objects: { flags: [{ x: 4, y: 2 }], effects: [{ x: 1, y: 1, kind: 'mystery' as const }] } };
    const resized = resizeMap(original, 3, 3) as typeof original;
    expect(resized.objects.flags).toEqual([]);
    expect(resized.objects.effects).toEqual([{ x: 1, y: 1, kind: 'mystery' }]);
    const h = historyStep({ past: [], present: original, future: [] }, { type: 'commit', map: resized });
    expect((historyStep(h, { type: 'undo' }).present as typeof original).objects.flags).toEqual([{ x: 4, y: 2 }]);
  });
  it('refuses an object on a base and removes an object when its cell becomes wall', () => {
    expect(paintObject(map, 0, 0, 'flag')).toEqual(map);
    const withFlag = paintObject(map, 1, 0, 'flag');
    expect(withFlag.objects?.flags).toEqual([{ x: 1, y: 0 }]);
    expect(paintMap(withFlag, [[1, 0]], '#', 'off').objects?.flags).toEqual([]);
  });
  it('reports cropped base cells and objects before applying a smaller map', () => {
    const original = { width: 5, height: 3, rows: ['1....', '....2', '.....'], objects: { flags: [{ x: 4, y: 2 }], effects: [{ x: 1, y: 1, kind: 'mystery' as const }] } };
    expect(resizeLosses(original, 3, 3)).toEqual({ bases: 1, flags: 1, effects: 0 });
  });
  it('enables the bonus criterion when the first flag is deliberately painted', () => {
    const rules = rulesSchema.parse({ flags: { mode: 'off', value: 75 } });
    const next = rulesFromEditorMap(rules, { ...rules.map, objects: { flags: [{ x: 8, y: 8 }], effects: [] } });
    expect(next.flags).toEqual({ mode: 'bonus', value: 75, target: 0, positions: [{ x: 8, y: 8 }] });
    expect(next.effects.mysteryPool).toEqual(rules.effects.mysteryPool);
    expect(rules.flags.mode).toBe('off');
  });
});
