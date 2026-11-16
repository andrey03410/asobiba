import { createRng } from '@asobiba/sdk';
import { describe, expect, it } from 'vitest';
import { findPlacements, placementError, type JinchiState } from './game';
import { rulesSchema } from './rules';

function state(rows: string[], overlapOwn = false, adjacency: 'side' | 'corner' = 'side'): JinchiState {
  const rules = rulesSchema.parse({ map: { width: rows[0]!.length, height: rows.length, rows: rows.map(row => row.replace(/[01]/g, value => String(Number(value) + 1))) }, placement: { overlapOwn, adjacency } });
  return { width: rules.map.width, height: rules.map.height, rules, cells: rows.join('').split('').map(value => value === '.' ? -1 : value === '#' ? -2 : Number(value)), bases: [], scores: [1, 1], points: [1, 1], flagCounts: [0, 0], effectPoints: [0, 0], rerollCharges: [0, 0], rotationLocked: [false, false], turnRotationLocked: false, rerolled: false, impossibleRoll: false, flags: [], effects: [], eliminated: [false, false], dice: [1, 1], currentSeat: 0, turn: 0, cycle: 1, result: null, events: [], lastMove: null, area: 1 };
}

describe('bounded placement and capacity', () => {
  it('limits returned hints without changing their legality', () => {
    const s = state(['000000', '......', '......', '......', '.....1']);
    const placements = findPlacements(s, 0, undefined, 2);
    expect(placements).toHaveLength(2);
    expect(placements.every(action => placementError(s, 0, action.x, action.y, action.rotated) === null)).toBe(true);
  });

  it('computes every dice-size capacity against an independent anchor scan', async () => {
    const geometry = await import('./placement').catch(() => null);
    const rng = createRng(732);
    for (const overlap of [false, true]) for (const adjacency of ['side', 'corner'] as const) for (let sample = 0; sample < 12; sample++) {
      const rows = Array.from({ length: 7 }, () => Array.from({ length: 9 }, () => rng.pick(['.', '.', '.', '#', '0', '1'])).join(''));
      const s = state(rows, overlap, adjacency);
      const capacity = geometry?.placementCapacity(s, 0);
      for (let h = 1; h <= 7; h++) for (let w = 1; w <= 9; w++) {
        s.dice = [w, h];
        for (const locked of [false, true]) {
          s.turnRotationLocked = locked;
          let expected = false;
          for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (placementError(s, 0, x, y, false) === null) expected = true;
          expect((capacity?.[h] ?? -1) >= w, JSON.stringify({ rows, w, h, overlap, adjacency, locked })).toBe(expected);
        }
      }
    }
  });

  it('forbids the rotated orientation consistently for search and the ghost', () => {
    const s = state(['0....', '.....', '.....', '.....', '....1']);
    s.dice = [1, 2];
    s.turnRotationLocked = true;
    expect(placementError(s, 0, 0, 1, true)).not.toBeNull();
    expect(findPlacements(s, 0).every(action => !action.rotated)).toBe(true);
    expect(findPlacements(s, 0, true)).toEqual([]);
  });
});
