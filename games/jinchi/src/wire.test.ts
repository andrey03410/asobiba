import { describe, expect, it } from 'vitest';
import { createJinchiDecoder, decodeGrid, encodeGrid, packJinchiMatch } from './wire';
import { Match, presetDocument } from '@asobiba/sdk';
import { jinchi } from './game';

describe('Jinchi self-contained wire snapshots', () => {
  it('roundtrips every owner and uses a bounded raw fallback for noisy grids', () => {
    const cells = Array.from({ length: 10_000 }, (_, i) => i % 10 - 2);
    const packed = encodeGrid(cells);
    expect(packed.data.length).toBeLessThanOrEqual(cells.length);
    expect(decodeGrid(packed, cells.length)).toEqual(cells);
    expect(decodeGrid(encodeGrid(Array(1_000_000).fill(-1)), 1_000_000)).toHaveLength(1_000_000);
  });

  it('rejects malformed runs before allocating beyond the board', () => {
    expect(() => decodeGrid({ encoding: 'runs', data: 'zzzzzz.', length: 100 }, 100)).toThrow();
    expect(() => decodeGrid({ encoding: 'raw', data: '.', length: 100 }, 100)).toThrow();
    expect(() => decodeGrid({ encoding: 'raw', data: '!', length: 1 }, 1)).toThrow();
  });

  it('restores a complete view after JSON and reuses immutable grids for repeated snapshots', () => {
    const config = presetDocument(jinchi, jinchi.presets[0]);
    const match = Match.start({ game: jinchi, config, seats: 2, seed: 42, startedAt: 0 });
    const view = match.view(0);
    const decode = createJinchiDecoder();
    const first = decode(JSON.parse(JSON.stringify(packJinchiMatch(view))));
    expect(first).toEqual(view);
    const second = decode(JSON.parse(JSON.stringify(packJinchiMatch(view))));
    expect((second.game as any).cells).toBe((first.game as any).cells);
    expect((second.game as any).bases).toBe((first.game as any).bases);
    expect((second.game as any).rules.map.rows).toBe((first.game as any).rules.map.rows);
    expect((first.game as any).canAct).toBe(true);
    expect(decode(packJinchiMatch(match.view(null))).game).toMatchObject({ canAct: false });
  });

  it('packs a million captured cells as ranges without changing their order or extent', () => {
    const config = presetDocument(jinchi, jinchi.presets[0]);
    const view = Match.start({ game: jinchi, config, seats: 2, seed: 42, startedAt: 0 }).view(0);
    const game = view.game as any;
    const cells = Array(1_000_000).fill(-1);
    const captured = Array.from({ length: cells.length }, (_, i) => i);
    const large = { ...view, game: { ...game, width: 1000, height: 1000, cells, bases: [...cells], rules: { ...game.rules, map: { width: 1000, height: 1000, rows: Array(1000).fill('.'.repeat(1000)) } }, lastMove: { seat: 0, turn: 1, indices: [50, 2, 3, 4], captured } } };
    const encoded = JSON.stringify(packJinchiMatch(large));
    expect(encoded.length).toBeLessThan(20_000);
    const restored = createJinchiDecoder()(JSON.parse(encoded));
    expect((restored.game as any).lastMove).toEqual(large.game.lastMove);
    expect((restored.game as any).cells).toEqual(cells);
  });

  it('rejects cached indices reused on a smaller board rather than skipping its bounds check', () => {
    const config = presetDocument(jinchi);
    const view = Match.start({ game: jinchi, config, seats: 2, seed: 42, startedAt: 0 }).view(0);
    const game = view.game as any;
    const indices = [1000];
    const move = { seat: 0, turn: 1, indices, captured: [] };
    packJinchiMatch({ ...view, game: { ...game, width: 32, height: 32, cells: Array(1024).fill(-1), bases: Array(1024).fill(-1), rules: { ...game.rules, map: { width: 32, height: 32, rows: Array(32).fill('.'.repeat(32)) } }, lastMove: move } });
    expect(() => packJinchiMatch({ ...view, game: { ...game, lastMove: move } })).toThrow();
  });

  it('rejects malformed ranges, map dimensions and oversized payloads', () => {
    const config = presetDocument(jinchi);
    const view = Match.start({ game: jinchi, config, seats: 2, seed: 42, startedAt: 0 }).view(0);
    const packed = packJinchiMatch(view);
    const game = packed.game as any;
    expect(() => createJinchiDecoder()({ ...packed, game: { ...game, width: 0 } })).toThrow();
    expect(() => createJinchiDecoder()({ ...packed, game: { ...game, lastMove: { indices: { encoding: 'ranges', data: [game.width * game.height - 1, 2], length: 2 }, captured: { encoding: 'raw', data: [], length: 0 } } } })).toThrow();
    expect(() => decodeGrid({ encoding: 'raw', data: '.'.repeat(100), length: 1 }, 1)).toThrow();
    expect(() => decodeGrid({ encoding: 'runs', data: 'zzzz:.;', length: 10 }, 10)).toThrow();
    expect(() => decodeGrid({ encoding: 'raw', data: '.', length: 1_000_001 }, 1_000_001)).toThrow();
  });

  it('keeps the order and duplicates of raw indices and updates only changed grid references', () => {
    const config = presetDocument(jinchi);
    const view = Match.start({ game: jinchi, config, seats: 2, seed: 42, startedAt: 0 }).view(0);
    const game = view.game as any;
    const decode = createJinchiDecoder();
    const first = decode(JSON.parse(JSON.stringify(packJinchiMatch(view))));
    const cells = [...game.cells]; cells[100] = 0;
    const move = { seat: 0, turn: 1, indices: [7, 7, 2, 1, 10, 11, 12], captured: [12, 11, 10, 10] };
    const second = decode(JSON.parse(JSON.stringify(packJinchiMatch({ ...view, game: { ...game, cells, lastMove: move, canAct: false, canReroll: false } }))));
    expect((second.game as any).lastMove).toEqual(move);
    expect((second.game as any).cells).not.toBe((first.game as any).cells);
    expect((second.game as any).cells[100]).toBe(0);
    expect((second.game as any).bases).toBe((first.game as any).bases);
    expect((second.game as any).rules.map.rows).toBe((first.game as any).rules.map.rows);
    expect(second.game).toMatchObject({ canAct: false, canReroll: false });
  });
});
