import { performance } from 'node:perf_hooks';
import { createRng } from '@asobiba/sdk';
import { expect, it } from 'vitest';
import { captureTerritory } from './capture';
import { jinchi } from './game';
import { placementCapacity } from './placement';
import { rulesSchema } from './rules';

it('keeps equal maximum components open without spreading hundreds of thousands of arguments', () => {
  const side = 1000;
  const cells = Array.from({ length: side * side }, (_, i) => (Math.floor(i / side) + i % side) % 2 ? 0 : -1);
  const rules = rulesSchema.parse({});
  const state = { width: side, height: side, cells, bases: Array(cells.length).fill(-1), rules };
  const result = captureTerritory(state, 0);
  expect(result).toEqual({ captured: [], enemies: 0 });
  expect(cells[0]).toBe(-1);
  expect(cells[1]).toBe(0);
});

it('captures a half-million-cell region on the maximum map and preserves the exterior', () => {
  const side = 1000;
  const cells = Array<number>(side * side).fill(-1);
  for (let y = 0; y < side; y++) cells[y * side + 499] = 0;
  const result = captureTerritory({ width: side, height: side, cells, bases: Array(cells.length).fill(-1), rules: rulesSchema.parse({}) }, 0);
  expect(result.captured).toHaveLength(499000);
  expect(cells[0]).toBe(0);
  expect(cells[999]).toBe(-1);
  expect(cells[999999]).toBe(-1);
});

it('models all d100 pairs and completes bounded unlucky cycles on a million-cell map', () => {
  const rows = Array.from({ length: 1000 }, () => '#'.repeat(1000));
  rows[999] = '#'.repeat(995) + '1#2.#';
  const rules = rulesSchema.parse({ map: { width: 1000, height: 1000, rows }, starts: { assignment: 'ordered' }, dice: { sides: 100 }, end: { skipRounds: 0, maxRounds: 130 } });
  const rng = createRng(1);
  rng.int = (_min, max) => max;
  rng.next = () => 1 - Number.EPSILON;
  const start = performance.now();
  const state = jinchi.setup({ rules, seats: 2, rng, now: 0, firstSeat: 0, round: 1 });
  expect(state.result?.reason).toBe('max-rounds');
  expect(state.turn).toBe(260);
  expect(placementCapacity(state, 1).slice(1, 4)).toEqual([1, 0, 0]);
  expect(performance.now() - start).toBeLessThan(2500);
});
