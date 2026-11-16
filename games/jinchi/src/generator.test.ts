import { describe, expect, it } from 'vitest';
import { generateMap, generationSchema, GenerationError } from './generator';
import { analyzeMap } from './balance';
import { checkRules, rulesSchema } from './rules';

describe('Jinchi map generation', () => {
  it('builds the requested circle for three players without changing radius or dice', () => {
    const generated = generateMap({ width: 101, height: 101, shape: 'circle', players: 3, seed: 42, dice: [6, 6], wallDensity: 20, structures: ['lakes', 'ridges'], balanced: true, flags: { mode: 'bonus', count: 9, value: 25 }, effects: { count: 9 } });
    expect(generated.map.width).toBe(101);
    expect(generated.map.height).toBe(101);
    expect(generated.map.rows[0]![0]).toBe('#');
    expect(generated.map.rows[0]![50]).not.toBe('#');
    expect(generated.map.expectedPlayers).toBe(3);
    expect(generated.diagnostics.balanced).toBe(true);
    expect(generated.diagnostics.bases.map(base => base.area)).toEqual([4, 4, 4]);
    expect(generated.flags.positions).toHaveLength(9);
    expect(generated.effects.cells).toHaveLength(9);
    expect(generated.effects.cells.filter(cell => cell.kind === 'mystery')).toHaveLength(6);
  });

  it('repeats a seed and gives a different landscape for another seed', () => {
    const request = { width: 81, height: 81, shape: 'circle' as const, players: 3, dice: [6, 6] as [number, number], wallDensity: 20, balanced: true };
    const first = generateMap({ ...request, seed: 17 });
    expect(generateMap({ ...request, seed: 17 })).toEqual(first);
    expect(generateMap({ ...request, seed: 18 }).map.rows).not.toEqual(first.map.rows);
  });

  it.each([2, 3, 4, 5, 6, 7, 8])('checks actual starting opportunities for %i players', players => {
    const generated = generateMap({ width: 129, height: 129, shape: 'circle', players, seed: 10 + players, dice: [6, 6], balanced: true });
    expect(generated.diagnostics.balanced).toBe(true);
    expect(generated.diagnostics.bases).toHaveLength(players);
    expect(generated.diagnostics.bases.every(base => base.allRollsFit && base.exits >= 2)).toBe(true);
    expect(generated.diagnostics.wallPercent).toBeGreaterThanOrEqual(18);
    expect(generated.diagnostics.wallPercent).toBeLessThanOrEqual(22);
  });

  it('rejects incompatible geometry instead of silently lowering dice or density', () => {
    expect(() => generateMap({ width: 15, height: 15, players: 3, dice: [100, 100], balanced: true })).toThrow();
    expect(generationSchema.safeParse({ width: 1001, height: 1000, players: 3 }).success).toBe(false);
    expect(generationSchema.safeParse({ width: 101, height: 101, players: 3, dice: [101, 6] }).success).toBe(false);
  });

  it('does not certify the nine-cell seed that brings different starting bases into contact', () => {
    let generated;
    try {
      generated = generateMap({ players: 3, width: 9, height: 9, shape: 'rectangle', dice: [2, 2], wallDensity: 0, effects: { count: 0 }, seed: 0 });
    } catch (error) {
      // A structured impossible-map rejection is allowed; silently certifying contact is not.
      expect(error).toBeInstanceOf(GenerationError);
      return;
    }
    const rules = rulesSchema.parse({ map: generated.map, dice: { sides: [2, 2] }, effects: generated.effects, flags: generated.flags });
    expect(checkRules(rules).filter(issue => issue.code === 'starts-touch')).toEqual([]);
  });

  it('does not certify a hand edited blocked base from stale metadata', () => {
    const generated = generateMap({ width: 81, height: 81, shape: 'circle', players: 3, seed: 9 });
    const rows = generated.map.rows.map(row => row.replaceAll('.', '#'));
    const rules = rulesSchema.parse({ map: { ...generated.map, rows } });
    const analysis = analyzeMap(rules);
    expect(analysis.balanced).toBe(false);
    expect(analysis.issues.some(issue => issue.code === 'balance-start-roll')).toBe(true);
  });

  it.each([2, 3, 4, 5, 6, 7, 8])('has a usable ordinary default for %i players', players => {
    const generated = generateMap({ players, seed: 5 });
    expect(generated.diagnostics.balanced).toBe(true);
    expect(generated.effects.cells).toHaveLength(players * 3);
  });

  it('supports the full million-cell rectangle with two d100 and all objects', () => {
    const generated = generateMap({ width: 1000, height: 1000, shape: 'rectangle', players: 3, seed: 42, dice: [100, 100], flags: { mode: 'primary', count: 9, target: 4 }, effects: { count: 9 } });
    expect(generated.map.rows).toHaveLength(1000);
    expect(generated.map.rows.every(row => row.length === 1000)).toBe(true);
    expect(generated.diagnostics.balanced).toBe(true);
    expect(generated.diagnostics.bases.every(base => base.allRollsFit)).toBe(true);
  }, 20_000);

  it('keeps regions reachable when large dice require broad reserved passages', () => {
    const generated = generateMap({ players: 3, radius: 30, seed: 7, dice: [6, 20] });
    expect(generated.diagnostics.balanced).toBe(true);
    expect(generated.diagnostics.unreachableArea).toBe(0);
    expect(generated.diagnostics.wallPercent).toBeGreaterThanOrEqual(18);
    expect(generated.diagnostics.wallPercent).toBeLessThanOrEqual(22);
  });
});

import { jinchi } from './game';
import { presetDocument } from '@asobiba/sdk';
it('starts a new ordinary configuration with known and unknown effects without changing old presets', () => {
  const ordinary = presetDocument(jinchi, jinchi.presets[0]);
  expect((ordinary.rules as any).effects.cells).toHaveLength(6);
  expect((ordinary.rules as any).effects.cells.filter((cell: any) => cell.kind === 'mystery')).toHaveLength(4);
  const legacy = presetDocument(jinchi, jinchi.presets.find(preset => preset.id === 'duel'));
  expect((legacy.rules as any).effects.cells).toHaveLength(0);
  expect((legacy.rules as any).dice.sides).toBe(6);
});
