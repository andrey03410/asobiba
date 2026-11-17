import { yomifuda } from '@asobiba/game-yomifuda';
import { presetDocument } from '@asobiba/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, resetDb, signUp, type TestApp } from '../test/helpers';
let t: TestApp;
beforeEach(async () => { t = await createTestApp(); await resetDb(t.db); });
afterEach(async () => { await t?.close(); });
it('keeps MCP authoring safe by default and uses original configs for by-id operations', async () => {
  const owner = await signUp(t, 'owner'), other = await signUp(t, 'other');
  const { secret } = await t.services.auth.createToken(owner.user.id, 'author');
  const client = new Client({ name: 'test', version: '1' });
  const base = await t.listen();
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${secret}` } } }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const json = JSON.parse((result.content as { type: string; text: string }[]).find(c => c.type === 'text')?.text ?? 'null');
    return { result, json };
  };
  const safe = (data: unknown) => { expect(JSON.stringify(data)).not.toContain('saitama'); expect(JSON.stringify(data)).not.toContain('values'); };
  try {
    const config = presetDocument(yomifuda, yomifuda.presets[0]);
    const valid = await call('config_validate', { config });
    expect(valid.json).toMatchObject({ ok: true, secretsHidden: true }); safe(valid.json);
    // The readonly projection cannot replace the original document in config_save.
    const projected = await call('config_save', { config: valid.json.config });
    expect(projected.result.isError).toBe(true); expect(projected.json.error.code).toBe('invalid_config');
    expect((await call('config_list', {})).json.configs).toEqual([]); expect(valid.json.config.rules.cards).toEqual([]);
    const saved = await call('config_save', { config });
    expect(saved.result.isError).not.toBe(true); safe(saved.json); const configId = saved.json.config.id;
    expect(saved.json.config.secretsHidden).toBe(true);
    safe((await call('config_list', {})).json);
    safe((await call('config_get', { configId })).json);
    safe((await call('config_get', { configId, revealSecrets: false })).json);
    expect((await call('config_get', { configId, revealSecrets: true })).json.config.document.rules.cards).toHaveLength(12);
    const foreign = await t.services.configs.save(other.user.id, config);
    expect((await call('config_get', { configId: foreign.id, revealSecrets: true })).result.isError).toBe(true);
    const byId = await call('config_validate', { configId });
    expect(byId.json).toMatchObject({ ok: true, configId, secretsHidden: true }); expect(byId.json.config).toBeUndefined(); safe(byId.json);
    const simulation = await call('config_simulate', { configId, rounds: 2 });
    expect(simulation.result.isError).not.toBe(true); safe(simulation.json);
    const preview = await call('config_preview', { configId });
    // Task3 will register the safe demo client and replace no_preview with a PNG assertion.
    expect(preview.json.error?.code).toBe('no_preview'); safe(preview.json);
    const lobby = await call('lobby_create', { configId, name: 'Cards' });
    expect(lobby.result.isError).not.toBe(true); safe(lobby.json);
    safe((await call('lobby_get', { lobbyId: lobby.json.lobby.id })).json);
  } finally { await client.close(); }
});
