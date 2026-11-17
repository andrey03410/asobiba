import type { ServerMessage } from '@asobiba/api';
import { yomifuda, type YomifudaRules, type YomifudaView } from '@asobiba/game-yomifuda';
import { presetDocument, type ConfigDocument } from '@asobiba/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, PNG_1x1, resetDb, signUp, type TestApp } from '../test/helpers';
let t: TestApp;
beforeEach(async () => { t = await createTestApp(); await resetDb(t.db); });
afterEach(async () => { await t?.close(); });

describe('Yomifuda safe lobby and media', () => {
  it('starts from a saved original and permits only own hand, revealed table and final deck assets', async () => {
    const host = await signUp(t, 'host'), player = await signUp(t, 'player'), third = await signUp(t, 'third');
    const viewer = await signUp(t, 'viewer'), outsider = await signUp(t, 'outsider');
    const config = presetDocument(yomifuda, yomifuda.presets[0]) as ConfigDocument<YomifudaRules>;
    config.rules.cards = config.rules.cards.slice(0, 6); config.rules.deckSize = 6; config.rules.handSize = 2; config.rules.revealSeconds = 0;
    for (const card of config.rules.cards) card.image = { asset: (await t.services.assets.save(host.user.id, { body: PNG_1x1, source: 'upload' })).id };
    const saved = await t.services.configs.save(host.user.id, config);
    const lobby = await t.services.lobbies.create(host.user, { name: 'Private deck', configId: saved.id });
    expect(lobby.config.rules).toMatchObject({ cards: [], deckSize: 6 });
    for (const p of [player, third]) await t.services.lobbies.join(p.user, lobby.id, 'player');
    await t.services.lobbies.join(viewer.user, lobby.id, 'spectator');
    const messages = new Map<string, ServerMessage[]>();
    const view = (id: string) => (messages.get(id)!.filter(m => m.type === 'match').at(-1) as Extract<ServerMessage, { type: 'match' }>).match!.game as YomifudaView;
    for (const p of [host, player, third, viewer]) {
      messages.set(p.user.id, []);
      await t.services.lobbies.subscribe({ userId: p.user.id, send: m => messages.get(p.user.id)!.push(m) }, lobby.id);
    }
    await t.services.lobbies.start(host.user, lobby.id);
    expect(view(player.user.id).hand).toHaveLength(2);
    const own = view(player.user.id).hand[0], hidden = view(third.user.id).hand[0];
    expect(await t.services.lobbies.canReadAsset(player.user.id, own.image!.asset)).toBe(true);
    expect(await t.services.lobbies.canReadAsset(player.user.id, hidden.image!.asset)).toBe(false);
    expect(await t.services.lobbies.canReadAsset(viewer.user.id, own.image!.asset)).toBe(false);
    expect(await t.services.lobbies.canReadAsset(host.user.id, hidden.image!.asset)).toBe(true); // owner retains pool access
    expect(view(viewer.user.id).hand).toEqual([]);
    expect(JSON.stringify(view(player.user.id))).not.toContain('values');
    expect(JSON.stringify(view(player.user.id))).not.toContain(hidden.id);
    expect((await t.app.inject({ url: `/files/assets/${hidden.image!.asset}`, headers: { cookie: player.cookie } })).statusCode).toBe(403);
    for (const p of [host, player, third]) {
      const shown = view(p.user.id);
      expect(await t.services.lobbies.action(p.user, lobby.id, { type: 'play', round: shown.round, cardId: shown.hand[0].id })).toEqual({ ok: true });
    }
    expect(view(viewer.user.id).phase).toMatch(/reveal|review/);
    expect(await t.services.lobbies.canReadAsset(viewer.user.id, hidden.image!.asset)).toBe(true);
    expect(await t.services.lobbies.canReadAsset(outsider.user.id, hidden.image!.asset)).toBe(false);
    expect((await t.app.inject({ url: `/files/assets/${hidden.image!.asset}`, headers: { cookie: viewer.cookie } })).statusCode).toBe(200);
    // Each hand is exhausted in exactly two battles, allowing a persisted final review.
    for (const p of [host, player, third]) expect(await t.services.lobbies.action(p.user, lobby.id, { type: 'ready', round: 1 })).toEqual({ ok: true });
    for (const p of [host, player, third]) expect(await t.services.lobbies.action(p.user, lobby.id, { type: 'play', round: 2, cardId: view(p.user.id).hand[0].id })).toEqual({ ok: true });
    for (const p of [host, player, third]) expect(await t.services.lobbies.action(p.user, lobby.id, { type: 'ready', round: 2 })).toEqual({ ok: true });
    expect(view(viewer.user.id).phase).toBe('finished'); expect(view(viewer.user.id).finalDeck).toHaveLength(6);
    await t.services.lobbies.join(player.user, lobby.id, 'spectator');
    expect(view(player.user.id).hand).toEqual([]);
    await t.close(); t = await createTestApp();
    expect(await t.services.lobbies.canReadAsset(viewer.user.id, config.rules.cards[5].image!.asset)).toBe(true);
  });
});
