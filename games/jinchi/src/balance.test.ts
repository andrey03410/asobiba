import { describe, expect, it } from 'vitest';
import { analyzeMap } from './balance';
import { checkRules, rulesSchema } from './rules';

function touchingMap(kind: 'side' | 'corner', certified = true) {
  const rows = Array.from({ length: 101 }, () => '.'.repeat(101));
  if (kind === 'side') {
    rows[49] = rows[50] = '.'.repeat(48) + '1122' + '.'.repeat(49);
  } else {
    rows[48] = rows[49] = '.'.repeat(48) + '11' + '.'.repeat(51);
    rows[50] = rows[51] = '.'.repeat(50) + '22' + '.'.repeat(49);
  }
  return rulesSchema.parse({ map: { width: 101, height: 101, rows, ...(certified ? { expectedPlayers: 2, generation: { version: 1, seed: 0, balanced: true, players: 2, shape: 'rectangle', wallDensity: 0 } } : {}) } });
}

describe('certified Jinchi start separation', () => {
  it.each(['side', 'corner'] as const)('rejects forged balance when different bases touch by %s', kind => {
    const rules = touchingMap(kind);
    const analysis = analyzeMap(rules);
    expect(analysis.balanced).toBe(false);
    expect(analysis.issues).toContainEqual(expect.objectContaining({ code: 'balance-starts-touch', severity: 'error' }));
    expect(checkRules(rules)).toContainEqual(expect.objectContaining({ code: 'balance-starts-touch', severity: 'error' }));
  });

  it.each(['side', 'corner'] as const)('keeps an intentional manual %s contact nonblocking', kind => {
    const rules = touchingMap(kind, false);
    expect(checkRules(rules)).toContainEqual(expect.objectContaining({ code: 'starts-touch', severity: 'warning' }));
    expect(checkRules(rules).filter(issue => issue.severity !== 'warning')).toEqual([]);
  });
});
