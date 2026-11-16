import { createHash } from 'node:crypto';
import { createRng, isActionError, Match, presetDocument } from '@asobiba/sdk';
import { describe, expect, it } from 'vitest';
import { findPlacements, jinchi, placementError, type JinchiAction, type JinchiState } from './game';
import { checkRules, rulesSchema, type JinchiRules } from './rules';

function position(rows = ['1....', '.....', '.....', '.....', '....2'], patch: Record<string, unknown> = {}): JinchiState {
  const rules = rulesSchema.parse({ map: { width: rows[0]!.length, height: rows.length, rows }, starts: { assignment: 'ordered' }, dice: { roll: 'manual' }, ...patch });
  const state = jinchi.setup({ rules, seats: 2, firstSeat: 0, round: 1, now: 0, rng: createRng(3) });
  return { ...state, dice: [1, 1] };
}
function act(state: JinchiState, action: JinchiAction, seed = 3): JinchiState {
  const next = jinchi.applyAction(state, state.currentSeat, action, { rules: state.rules, seats: state.scores.length, rng: createRng(seed), now: 0 });
  if (isActionError(next)) throw new Error(next.error.message);
  return next;
}
const place = (state: JinchiState, x: number, y: number) => act(state, { type: 'place', x, y, rotated: false });

describe('Jinchi extended rules', () => {
  it('accepts independent d100, preserves legacy sides and rejects 101', () => {
    expect(rulesSchema.parse({}).dice.sides).toBe(6);
    expect(rulesSchema.parse({ dice: { sides: 20 } }).dice.sides).toBe(20);
    expect(rulesSchema.parse({ dice: { sides: [6, 100] } }).dice.sides).toEqual([6, 100]);
    expect(rulesSchema.safeParse({ dice: { sides: [6, 101] } }).success).toBe(false);
    const rows = ['1' + '.'.repeat(999), ...Array.from({ length: 998 }, () => '.'.repeat(1000)), '.'.repeat(999) + '2'];
    expect(rulesSchema.safeParse({ map: { width: 1000, height: 1000, rows } }).success).toBe(true);
    expect(rulesSchema.safeParse({ map: { width: 1001 } }).success).toBe(false);
  });

  it('rejects objects on bases, walls, another object or outside the map', () => {
    for (const [x, y] of [[0, 0], [5, 0], [1, 1]]) {
      const s = position(['1....', '.#...', '.....', '.....', '....2'], { flags: { mode: 'bonus', positions: [{ x, y }] } });
      expect(checkRules(s.rules).some(i => i.severity !== 'warning')).toBe(true);
    }
    const s = position(undefined, { flags: { mode: 'bonus', positions: [{ x: 1, y: 0 }] }, effects: { cells: [{ x: 1, y: 0, kind: 'cache' }] } });
    expect(checkRules(s.rules).some(i => i.code === 'object-overlap')).toBe(true);
  });

  it('rejects impossible flag goals, conflicting area goals and empty mystery pools', () => {
    for (const patch of [
      { flags: { mode: 'primary', target: 2, positions: [{ x: 1, y: 0 }] } },
      { flags: { mode: 'bonus', positions: [{ x: 1, y: 0 }] }, end: { targetPercent: 50 } },
      { effects: { cells: [{ x: 1, y: 0, kind: 'mystery' }], mysteryPool: [{ kind: 'cache', weight: 0 }] } },
    ]) expect(checkRules(position(undefined, patch).rules).some(i => i.severity !== 'warning')).toBe(true);
  });

  it('does not warn about strong outcomes when no mystery or scoring effect is enabled', () => {
    const s = position(['1..', '...', '..2']);
    expect(checkRules(s.rules).some(issue => issue.code === 'strong-effect')).toBe(false);
  });

  it('keeps independently parsed mystery settings independent', () => {
    const first = rulesSchema.parse({});
    const second = rulesSchema.parse({});
    first.effects.mysteryPool[0]!.weight = 0;
    expect(second.effects.mysteryPool[0]!.weight).toBe(35);
  });

  it('uses exact player counts only for a generated balanced map', () => {
    const s = position(undefined, { map: { width: 5, height: 5, rows: ['1....', '.....', '.....', '.....', '....2'], expectedPlayers: 2, generation: { version: 1, seed: 1, balanced: true, players: 2, shape: 'rectangle', wallDensity: 0 } } });
    expect(jinchi.seats(s.rules)).toEqual({ min: 2, max: 2 });
    expect(jinchi.seats(rulesSchema.parse({})).min).toBe(2);
  });

  it('rechecks geometry instead of trusting forged balanced metadata', () => {
    const s = position(['1....', '.....', '.....', '.....', '....2'], { dice: { sides: 100, roll: 'manual' }, map: { width: 5, height: 5, rows: ['1....', '.....', '.....', '.....', '....2'], expectedPlayers: 2, generation: { version: 1, seed: 1, balanced: true, players: 2, shape: 'rectangle', wallDensity: 0 } } });
    expect(checkRules(s.rules)).toContainEqual(expect.objectContaining({ code: 'balance-start-roll', severity: 'error' }));
  });
});

describe('Jinchi one-shot objects and results', () => {
  it('collects a flag and known bonus only once even if their cell changes owner again', () => {
    let s = position(undefined, { flags: { mode: 'bonus', value: 25, positions: [{ x: 1, y: 0 }] }, effects: { cells: [{ x: 0, y: 1, kind: 'cache', value: 10 }] } });
    s = place(s, 1, 0);
    expect(s.flagCounts).toEqual([1, 0]);
    expect(s.points[0]).toBe(27);
    s = { ...s, currentSeat: 0, dice: [1, 1] };
    s = place(s, 0, 1);
    expect(s.effectPoints).toEqual([10, 0]);
    expect(s.points[0]).toBe(38);
    expect(s.flags).toEqual([]);
    expect(s.effects).toEqual([]);
    s = { ...s, currentSeat: 0, dice: [1, 1], cells: [...s.cells] };
    s.cells[1] = -1;
    s = place(s, 1, 0);
    expect(s.flagCounts).toEqual([1, 0]);
    expect(s.effectPoints[0]).toBe(10);
  });

  it('collects every enclosed object before testing the flag goal', () => {
    const s = position(['.......', '.111...', '.1.1...', '.1.....', '.1.1...', '.111...', '......2'], {
      flags: { mode: 'primary', target: 2, positions: [{ x: 2, y: 2 }, { x: 2, y: 4 }] },
      effects: { cells: [{ x: 2, y: 3, kind: 'trap', value: 15 }] },
    });
    const next = place(s, 3, 3);
    expect(next.flagCounts).toEqual([2, 0]);
    expect(next.effectPoints).toEqual([-15, 0]);
    expect(next.result).toMatchObject({ reason: 'flag-target', winners: [0] });
    expect(next.flags).toHaveLength(0);
    expect(next.effects).toHaveLength(0);
  });

  it.each([
    ['off', [0]], ['primary', [1]], ['bonus', [1]],
  ] as const)('compares the %s objective using its advertised criterion', (mode, winners) => {
    let s = position(undefined, { flags: { mode, value: 25, positions: mode === 'off' ? [] : [{ x: 2, y: 0 }, { x: 3, y: 0 }] }, end: { maxRounds: 1 } });
    s = { ...s, flagCounts: [0, 1], effectPoints: [5, 0], points: [6, mode === 'bonus' ? 26 : 1], cycleSeats: [1] };
    const next = place(s, 1, 0);
    expect(next.result).toMatchObject({ reason: 'max-rounds', winners: [...winners] });
  });

  it('gives last-player victory priority over flags and excludes eliminated leaders', () => {
    const s = position(['.......', '.111...', '.1.1...', '.12....', '.1.1...', '.111...', '.......'], {
      flags: { mode: 'primary', positions: [{ x: 0, y: 0 }] },
    });
    s.flagCounts = [0, 100];
    expect(place(s, 3, 3).result).toMatchObject({ reason: 'last-player', winners: [0] });
  });

  it('uses effects as points without deleting territory, and permits a negative total', () => {
    const next = place(position(undefined, { effects: { cells: [{ x: 1, y: 0, kind: 'trap', value: 100 }] } }), 1, 0);
    expect(next.scores[0]).toBe(2);
    expect(next.effectPoints[0]).toBe(-100);
    expect(next.points[0]).toBe(-98);
    expect(next.eliminated[0]).toBe(false);
  });

  it('ends only primary flags when all flags are collected', () => {
    for (const mode of ['primary', 'bonus'] as const) {
      const next = place(position(undefined, { flags: { mode, positions: [{ x: 1, y: 0 }] } }), 1, 0);
      if (mode === 'primary') expect(next.result?.reason).toBe('flags-collected');
      else expect(next.result).toBeNull();
    }
  });

  it('uses secondary points for equal flags and shares a full tie', () => {
    let s = position(undefined, { flags: { mode: 'primary', positions: [{ x: 2, y: 2 }] }, end: { maxRounds: 1 } });
    s = { ...s, flagCounts: [1, 1], effectPoints: [0, 10], cycleSeats: [1] };
    expect(place(s, 1, 0).result?.winners).toEqual([1]);
    s = { ...s, effectPoints: [0, 1] };
    expect(place(s, 1, 0).result).toMatchObject({ winners: [0, 1], draw: true });
  });

  it('excludes an eliminated flag leader when more than one player remains', () => {
    const rules = rulesSchema.parse({ map: { width: 5, height: 5, rows: ['1...2', '.....', '.....', '.....', '..3..'] }, dice: { roll: 'manual' }, starts: { assignment: 'ordered' }, flags: { mode: 'primary', positions: [{ x: 2, y: 2 }] }, end: { maxRounds: 1 } });
    let s = jinchi.setup({ rules, seats: 3, firstSeat: 0, round: 1, rng: createRng(1), now: 0 });
    s = { ...s, cells: [...s.cells], scores: [1, 1, 0], eliminated: [false, false, true], flagCounts: [1, 2, 100], cycleSeats: [1], dice: [1, 1] };
    s.cells[22] = -1;
    expect(place(s, 1, 0).result?.winners).toEqual([1]);
  });

  it('finishes a reached flag target before a coincident round limit', () => {
    const s = position(undefined, { flags: { mode: 'primary', target: 1, positions: [{ x: 1, y: 0 }, { x: 2, y: 2 }] }, end: { maxRounds: 1 } });
    s.cycleSeats = [1];
    expect(place(s, 1, 0).result).toMatchObject({ reason: 'flag-target', winners: [0] });
  });

  it('does not use effect points as territory for an immediate area goal', () => {
    const s = position(undefined, { end: { targetPercent: 50 }, effects: { cells: [{ x: 1, y: 0, kind: 'cache', value: 1000 }] } });
    const next = place(s, 1, 0);
    expect(next.points[0]).toBe(1002);
    expect(next.result).toBeNull();
  });

  it('sums enclosed bonuses and penalties while capping multiple charges and locks', () => {
    const s = position(['.........', '.11111...', '.1...1...', '.1.......', '.1...1...', '.11111...', '........2'], {
      effects: { cells: [{ x: 2, y: 2, kind: 'cache', value: 25 }, { x: 3, y: 2, kind: 'trap', value: 15 }, { x: 4, y: 2, kind: 'reroll' }, { x: 2, y: 3, kind: 'reroll' }, { x: 3, y: 3, kind: 'lock' }, { x: 4, y: 3, kind: 'lock' }] },
    });
    s.rerollCharges = [2, 0];
    const next = place(s, 5, 3);
    expect(next.effectPoints).toEqual([10, 0]);
    expect(next.rerollCharges).toEqual([3, 0]);
    expect(next.rotationLocked).toEqual([true, false]);
    expect(next.effects).toEqual([]);
    expect(next.events.find(event => event.type === 'objects')?.text).toMatch(/тайник.*ловушка.*предел 3/);
  });
});

describe('Jinchi rerolls and rotation locks', () => {
  it('caps charges at three and gives no bonus points for overflow', () => {
    let s = position(undefined, { effects: { cells: [{ x: 1, y: 0, kind: 'reroll' }] } });
    s.rerollCharges = [3, 0];
    s = place(s, 1, 0);
    expect(s.rerollCharges).toEqual([3, 0]);
    expect(s.effectPoints).toEqual([0, 0]);
  });

  it('rerolls both independent dice only once without changing the turn identity', () => {
    const s = position(undefined, { dice: { sides: [6, 20], roll: 'manual' } });
    s.rerollCharges = [2, 0];
    const next = act(s, { type: 'reroll' });
    expect(next.turn).toBe(s.turn);
    expect(next.rerollCharges).toEqual([1, 0]);
    expect(next.rerolled).toBe(true);
    const ctx = { rules: next.rules, seats: 2, rng: createRng(3), now: 0 };
    expect(isActionError(jinchi.applyAction(next, 0, { type: 'reroll' }, ctx))).toBe(true);
  });

  it('rejects a charge before rolling, and never spends one in the random timeout action', () => {
    let s = position(undefined, { dice: { sides: 2, roll: 'manual' } });
    s = { ...s, rerollCharges: [1, 0], dice: null };
    const ctx = { rules: s.rules, seats: 2, rng: createRng(1), now: 0 };
    expect(isActionError(jinchi.applyAction(s, 0, { type: 'reroll' }, ctx))).toBe(true);
    s = { ...s, dice: [1, 1] };
    expect(jinchi.sampleAction!(s, 0, ctx)?.type).toBe('place');
    const impossible = position(['1#2', '.##', '###'], { dice: { sides: 100, roll: 'manual' } });
    impossible.dice = [100, 100]; impossible.rerollCharges = [1, 0];
    expect(jinchi.sampleAction!(impossible, 0, { ...ctx, rules: impossible.rules })?.type).toBe('skip-impossible');
  });

  it('offers a charge or explicit skip for an impossible original roll, then auto-skips an impossible reroll', () => {
    const s = position(['1#2', '.##', '###'], { dice: { sides: 100, roll: 'manual' }, end: { skipRounds: 0 } });
    s.dice = [100, 100];
    s.rerollCharges = [1, 0];
    expect(jinchi.view(s, 0)).toMatchObject({ impossibleRoll: true, canReroll: true, canSkip: true });
    const skipped = act(s, { type: 'skip-impossible' });
    expect(skipped.currentSeat).toBe(1);
    expect(skipped.rerollCharges).toEqual([1, 0]);
    const rerolled = act(s, { type: 'reroll' });
    expect(rerolled.currentSeat).toBe(1);
    expect(rerolled.rerollCharges).toEqual([0, 0]);
    const playable = { ...s, dice: [1, 1] as [number, number] };
    expect(isActionError(jinchi.applyAction(playable, 0, { type: 'skip-impossible' }, { rules: playable.rules, seats: 2, rng: createRng(1), now: 0 }))).toBe(true);
  });

  it('applies a collected lock next turn, expires it on timeout, and retains a new pending lock', () => {
    let s = position(undefined, { effects: { cells: [{ x: 1, y: 0, kind: 'lock' }, { x: 0, y: 1, kind: 'lock' }] } });
    s = place(s, 1, 0);
    expect(s.rotationLocked[0]).toBe(true);
    expect(s.turnRotationLocked).toBe(false);
    s = { ...s, dice: [1, 1] };
    s = place(s, 3, 4);
    expect(s.currentSeat).toBe(0);
    expect(s.turnRotationLocked).toBe(true);
    expect(jinchi.view(s, 0).canRotate).toBe(false);
    s = { ...s, dice: [1, 2] };
    expect(placementError(s, 0, 0, 1, true)).toMatch(/поворот|поворачивать/i);
    s = { ...s, dice: [1, 1] };
    s = place(s, 0, 1);
    expect(s.rotationLocked[0]).toBe(true);
    s = jinchi.passTurn!(s, 1, { rules: s.rules, seats: 2, rng: createRng(1), now: 0 });
    expect(s.turnRotationLocked).toBe(true);
    s = jinchi.passTurn!(s, 0, { rules: s.rules, seats: 2, rng: createRng(1), now: 0 });
    s = jinchi.passTurn!(s, 1, { rules: s.rules, seats: 2, rng: createRng(1), now: 0 });
    expect(s.turnRotationLocked).toBe(false);
  });
});

describe('Jinchi randomness and legacy replay', () => {
  it.each(['cache', 'trap', 'reroll', 'lock'] as const)('resolves mystery %s only on collection with the match RNG', kind => {
    const s = position(undefined, { effects: { cells: [{ x: 1, y: 0, kind: 'mystery' }], mysteryPool: [{ kind, value: kind === 'cache' || kind === 'trap' ? 10 : undefined, weight: 1 }] } });
    expect(jinchi.view(s, null).effects).toEqual([{ x: 1, y: 0, kind: 'mystery' }]);
    const next = place(s, 1, 0);
    expect(next.effects).toEqual([]);
    expect(next.effectPoints[0]).toBe(kind === 'cache' ? 10 : kind === 'trap' ? -10 : 0);
    expect(next.rerollCharges[0]).toBe(kind === 'reroll' ? 1 : 0);
    expect(next.rotationLocked[0]).toBe(kind === 'lock');
  });

  it('reveals multiple mysteries in cell order rather than author array order', () => {
    const s = position(['.......', '.111...', '.1.1...', '.1.....', '.1.1...', '.111...', '......2'], {
      effects: { cells: [{ x: 2, y: 4, kind: 'mystery' }, { x: 2, y: 2, kind: 'mystery' }, { x: 2, y: 3, kind: 'mystery' }], mysteryPool: [{ kind: 'cache', value: 25, weight: 1 }, { kind: 'trap', value: 15, weight: 1 }] },
    });
    const next = place(s, 3, 3);
    expect(next.effectPoints[0]).toBe(35);
    expect(next.events.find(event => event.type === 'objects')?.text).toBe('ловушка −15; тайник +25; тайник +25');
  });

  it('keeps the historical accelerated ordered-pair sampling and RNG position', () => {
    const rules = rulesSchema.parse({ map: { width: 3, height: 3, rows: ['1#2', '.##', '###'] }, starts: { assignment: 'ordered' }, dice: { sides: 20 }, end: { skipRounds: 0 } });
    const rng = createRng(321);
    const s = jinchi.setup({ rules, seats: 2, rng, now: 0, round: 1, firstSeat: 0 });
    expect({ turn: s.turn, cycle: s.cycle, dice: s.dice, currentSeat: s.currentSeat, rng: rng.state() }).toEqual({ turn: 874, cycle: 438, dice: [1, 1], currentSeat: 0, rng: 694862482 });
    expect(createHash('sha256').update(JSON.stringify(s.events)).digest('hex')).toBe('73d41a461fcf5fef4fa173ebd61d9033fb4890a1385069d29c4e934577ccae86');
  });

  it('replays historical manual-roll random timeouts with the singleton action RNG draw', () => {
    const config = presetDocument(jinchi);
    config.rules = rulesSchema.parse({ dice: { sides: 6, roll: 'manual' }, starts: { assignment: 'ordered' } });
    config.timer = { turnSeconds: 1, onTimeout: 'random' };
    const match = Match.start({ game: jinchi, config, seats: 2, seed: 321, startedAt: 0 });
    match.advance(3000);
    const state = match.view(null).game as JinchiState;
    // Golden from the pre-hook SDK: pick([{roll}]) consumed a draw before each roll.
    expect(state.events.filter(event => event.type === 'roll').map(event => event.text)).toEqual(['Выпало 4:2', 'Выпало 4:4', 'Выпало 1:1']);
    expect(state.scores).toEqual([13, 20]);
    expect(createHash('sha256').update(JSON.stringify(state.cells)).digest('hex')).toBe('d31fd668bde75ac6e15c01971fbd5247889f4dee5d295f0a98291d370b6b7296');
    const restored = Match.restore({ game: jinchi, config, record: { seed: 321, startedAt: 0, seats: 2, log: [] }, now: 3000 });
    expect(restored.view(null)).toEqual(match.view(null));
  });

  it('restores weighted mystery results and preserves the timer through reroll', () => {
    const config = presetDocument(jinchi);
    config.rules = position(undefined, { effects: { cells: [{ x: 1, y: 0, kind: 'mystery' }], mysteryPool: [{ kind: 'reroll', weight: 1 }] }, dice: { sides: 2, roll: 'manual' } }).rules;
    config.timer = { turnSeconds: 10, onTimeout: 'skip' };
    const match = Match.start({ game: jinchi, config, seats: 2, seed: 7, startedAt: 0 });
    expect(match.dispatch(0, { type: 'roll' }, 1).ok).toBe(true);
    expect(match.dispatch(0, { type: 'place', x: 1, y: 0, rotated: false }, 2).ok).toBe(true);
    expect((match.view(0).game as JinchiState).rerollCharges[0]).toBe(1);
    expect(match.dispatch(1, { type: 'roll' }, 3).ok).toBe(true);
    const state = match.view(1).game as JinchiState;
    expect(match.dispatch(1, findPlacements(state, 1)[0]!, 4).ok).toBe(true);
    const deadline = match.view(0).turnDeadline;
    expect(match.dispatch(0, { type: 'roll' }, 5).ok).toBe(true);
    expect(match.dispatch(0, { type: 'reroll' }, 6).ok).toBe(true);
    expect(match.view(0).turnDeadline).toBe(deadline);
    expect(match.dispatch(0, { type: 'reroll' }, 7).ok).toBe(false);
    const restored = Match.restore({ game: jinchi, config, record: match.record(), now: 7 });
    expect(restored.view(null)).toEqual(match.view(null));
  });

  it('resets every one-shot object and player effect in the next round', () => {
    const original = position(undefined, { flags: { mode: 'bonus', positions: [{ x: 1, y: 0 }] }, effects: { cells: [{ x: 0, y: 1, kind: 'reroll' }] } });
    const played = place(original, 1, 0);
    expect(played.flagCounts[0]).toBe(1);
    const reset = jinchi.setup({ rules: original.rules, seats: 2, firstSeat: 1, round: 2, rng: createRng(3), now: 1 });
    expect(reset.flags).toEqual([{ x: 1, y: 0 }]);
    expect(reset.effects).toEqual([{ x: 0, y: 1, kind: 'reroll' }]);
    expect([reset.flagCounts, reset.effectPoints, reset.rerollCharges]).toEqual([[0, 0], [0, 0], [0, 0]]);
    expect(reset.rotationLocked).toEqual([false, false]);
  });
});
