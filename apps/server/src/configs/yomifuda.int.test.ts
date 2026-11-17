import { yomifuda, type YomifudaRules } from '@asobiba/game-yomifuda';
import { createCatalog, presetDocument, type ConfigDocument } from '@asobiba/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mp4, wav } from '../assets/media-fixtures';
import { createTestApp, PNG_1x1, resetDb, signUp, type TestApp, type TestUser } from '../test/helpers';
import { ConfigService } from './service';

let t: TestApp, owner: TestUser, other: TestUser, configs: ConfigService;
const document = () => presetDocument(yomifuda, yomifuda.presets[0]) as ConfigDocument<YomifudaRules>;
function hidden(config: ConfigDocument) {
  expect(config.rules).toMatchObject({ cards: [], deckSize: 12, players: 3 });
  expect(JSON.stringify(config)).not.toContain('saitama');
  expect(JSON.stringify(config)).not.toContain('values');
}
beforeEach(async () => {
  t = await createTestApp(); await resetDb(t.db);
  owner = await signUp(t, 'owner'); other = await signUp(t, 'other');
  configs = new ConfigService(t.db, createCatalog([yomifuda]), t.services.assets);
});
afterEach(async () => { await t?.close(); });

describe('Yomifuda secret config boundary', () => {
  it('projects save/list/default get while retaining an immutable owner-only original', async () => {
    const source = document();
    const saved = await configs.save(owner.user.id, source);
    expect(saved).toMatchObject({ secretsHidden: true }); hidden(saved.document);
    const listed = await configs.list(owner.user.id); hidden(listed[0].document);
    hidden((await configs.get(owner.user.id, saved.id)).document);
    const original = await configs.getOriginal(owner.user.id, saved.id);
    expect(original.document.rules).toEqual(source.rules);
    expect(original.secretsHidden).not.toBe(true);
    const explicit = await configs.get(owner.user.id, saved.id, { revealSecrets: true });
    expect(explicit.document.rules).toEqual(source.rules);
    await expect(configs.getOriginal(other.user.id, saved.id)).rejects.toMatchObject({ status: 404 });
    await expect(configs.get(other.user.id, saved.id, { revealSecrets: true })).rejects.toMatchObject({ status: 404 });
    expect(await configs.list(other.user.id)).toEqual([]);
  });

  it('returns a safe normalized validation but requireValid preserves cards for execution', async () => {
    const source = document(); const checked = await configs.validate(owner.user.id, source);
    expect(checked).toMatchObject({ ok: true, secretsHidden: true }); if (!checked.ok) throw new Error('invalid fixture');
    hidden(checked.config); expect(source.rules.cards).toHaveLength(12);
    expect((await configs.requireValid(owner.user.id, source)).rules).toEqual(source.rules);
  });

  it.each(['audio', 'video'] as const)('rejects %s in a card image at the exact asset path', async (kind) => {
    const asset = await t.services.assets.save(owner.user.id, { body: kind === 'audio' ? wav() : mp4(), source: 'upload' });
    const config = document(); config.rules.cards[0].image = { asset: asset.id };
    const checked = await configs.validate(owner.user.id, config);
    expect(checked.ok).toBe(false);
    expect(checked.issues).toContainEqual(expect.objectContaining({ path: 'rules.cards[0].image.asset', code: 'asset_mime' }));
  });

  it('accepts only owned images and excludes image references from safe documents', async () => {
    const asset = await t.services.assets.save(owner.user.id, { body: PNG_1x1, source: 'upload' });
    const config = document(); config.rules.cards[0].image = { asset: asset.id };
    const checked = await configs.validate(owner.user.id, config);
    expect(checked.ok).toBe(true); expect(JSON.stringify(checked)).not.toContain(asset.id);
    expect((await configs.validate(other.user.id, config)).issues).toContainEqual(expect.objectContaining({ code: 'asset_not_found' }));
  });

  it('keeps HTTP save/list/get/validate safe and requires an explicit author query', async () => {
    const request = (method: 'GET' | 'POST' | 'PUT', url: string, config?: unknown, cookie = owner.cookie) =>
      t.app.inject({ method, url, headers: { cookie }, ...(config ? { payload: { config } } : {}) });
    const saved = await request('POST', '/api/configs', document());
    expect(saved.statusCode).toBe(201); hidden(saved.json().config.document);
    const id = saved.json().config.id;
    hidden((await request('GET', '/api/configs')).json().configs[0].document);
    hidden((await request('GET', `/api/configs/${id}`)).json().config.document);
    hidden((await request('GET', `/api/configs/${id}?revealSecrets=false`)).json().config.document);
    const original = await request('GET', `/api/configs/${id}?revealSecrets=true`);
    expect(original.json().config.document.rules.cards).toHaveLength(12);
    expect((await request('GET', `/api/configs/${id}?revealSecrets=true`, undefined, other.cookie)).statusCode).toBe(404);
    const checked = await request('POST', '/api/configs/validate', document());
    expect(checked.json()).toMatchObject({ ok: true, secretsHidden: true }); hidden(checked.json().config);
    hidden((await request('PUT', `/api/configs/${id}`, document())).json().config.document);
  });
});


it('rejects repeated decks at HTTP validate/save/create, including existing saved originals', async () => {
  const config = document(); config.series.rounds = 2;
  const request = (url: string, payload: Record<string, unknown>) => t.app.inject({ method: 'POST', url, headers: { cookie: owner.cookie }, payload });
  const checked = await request('/api/configs/validate', { config });
  expect(checked.json()).toMatchObject({ ok: false, issues: [expect.objectContaining({ path: 'series.rounds' })] });
  expect((await request('/api/configs', { config })).statusCode).toBe(422);
  expect((await request('/api/lobbies', { config, name: 'Repeated deck' })).statusCode).toBe(422);
  expect(await configs.list(owner.user.id)).toEqual([]);
  const saved = await configs.save(owner.user.id, document());
  await t.db.gameConfig.update({ where: { id: saved.id }, data: { document: JSON.parse(JSON.stringify(config)) } });
  expect((await request('/api/lobbies', { configId: saved.id, name: 'Legacy repeated deck' })).statusCode).toBe(422);
});
