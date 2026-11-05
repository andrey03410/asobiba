import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('deploys migrations into an absent SQLite file on a clean checkout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asobiba-cli-'));
  const file = join(dir, 'fresh.db');
  try {
    const run = spawnSync(process.execPath, [resolve('scripts/prisma.mjs'), 'migrate', 'deploy'], {
      cwd: resolve('.'), env: { ...process.env, DATABASE_URL: `file:${file}`, PRISMA_HIDE_UPDATE_MESSAGE: '1' }, encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    expect(statSync(file).size).toBeGreaterThan(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
