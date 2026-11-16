import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDb, signUp, type TestApp } from '../test/helpers';

let t: TestApp;
beforeEach(async () => { t = await createTestApp(); await resetDb(t.db); await t.listen(); });
afterEach(async () => { await t?.close(); });

async function agent(login: string) {
  const owner = await signUp(t, login);
  const { secret } = await t.services.auth.createToken(owner.user.id, 'Generator');
  const client = new Client({ name: 'map-builder', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${t.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }));
  return { owner, client };
}
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text?: string; data?: string }[];
  const text = content.find(block => block.type === 'text')?.text ?? 'null';
  let json: any;
  try { json = JSON.parse(text); } catch { json = { error: { message: text } }; }
  return { isError: Boolean(result.isError), json, content };
}

describe('Jinchi generation through the agent', () => {
  it('uses a compact saved reference from generation through PNG and a strict lobby', async () => {
    const { client, owner } = await agent('maker');
    try {
      const generated = await call(client, 'jinchi_generate', { request: { radius: 50, players: 3, seed: 42, flags: { mode: 'bonus', count: 9 }, effects: { count: 9 } }, title: 'Трое на круге' });
      expect(generated.isError).toBe(false);
      expect(generated.json.configId).toMatch(/^cfg_/);
      expect(generated.json.diagnostics).toMatchObject({ balanced: true });
      expect(JSON.stringify(generated.json).length).toBeLessThan(12_000);
      expect(generated.json).not.toHaveProperty('config');
      const valid = await call(client, 'config_validate', { configId: generated.json.configId });
      expect(valid.json).toMatchObject({ ok: true, configId: generated.json.configId, summary: { players: { min: 3, max: 3 } } });
      expect(valid.json).not.toHaveProperty('config');
      const preview = await call(client, 'config_preview', { configId: generated.json.configId, moment: 'start' });
      expect(preview.isError).toBe(false);
      expect(preview.content.some(block => block.type === 'image' && block.data)).toBe(true);
      const simulated = await call(client, 'config_simulate', { configId: generated.json.configId, rounds: 1 });
      expect(simulated.isError).toBe(false);
      const created = await call(client, 'lobby_create', { name: 'Трое', configId: generated.json.configId });
      expect(created.json.lobby.summary.players).toEqual({ min: 3, max: 3 });
      const start = await t.app.inject({ method: 'POST', url: `/api/lobbies/${created.json.lobby.id}/start`, headers: { cookie: owner.cookie } });
      expect(start.statusCode).toBe(409);
      expect(start.json().error.message).toContain('3');
    } finally { await client.close(); }
  });

  it('rechecks saved reference ownership for every validation and rejects ambiguous input', async () => {
    const first = await agent('first');
    const second = await agent('second');
    try {
      const generated = await call(first.client, 'jinchi_generate', { request: { players: 2, seed: 3 } });
      expect(generated.isError).toBe(false);
      for (const name of ['config_validate', 'config_simulate', 'config_preview']) {
        const foreign = await call(second.client, name, { configId: generated.json.configId });
        expect(foreign.isError).toBe(true);
      }
      const ambiguous = await call(first.client, 'config_validate', { configId: generated.json.configId, config: {} });
      expect(ambiguous.isError).toBe(true);
      const invalid = await call(first.client, 'jinchi_generate', { request: { width: 15, height: 15, players: 3, dice: [100, 100] } });
      expect(invalid.isError).toBe(true);
      expect(invalid.json.error.message).toContain('Кубики');
    } finally { await first.client.close(); await second.client.close(); }
  });

  it('serves the same generator to the authenticated site without saving unsolicited library entries', async () => {
    const owner = await signUp(t, 'website');
    const response = await t.app.inject({ method: 'POST', url: '/api/games/jinchi/generate', headers: { cookie: owner.cookie }, payload: { request: { players: 3, radius: 30, seed: 7, dice: [6, 20] } } });
    expect(response.statusCode).toBe(200);
    expect(response.json().config.rules.dice.sides).toEqual([6, 20]);
    expect(response.json().diagnostics.balanced).toBe(true);
    expect(await t.db.gameConfig.count()).toBe(0);
    expect((await t.app.inject({ method: 'POST', url: '/api/games/jinchi/generate', payload: { request: { players: 3 } } })).statusCode).toBe(401);
  });
});
