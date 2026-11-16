#!/usr/bin/env -S node --import tsx
// Live task 08 verification. Credentials stay in storage; browser-lobbies.json is public evidence.
// --prepare: join the task's waiting UI lobby and start the maximum lobby at turn 0.
// --independent / --stress: disposable protocol and heavy-capture scenarios.
// --prepare-info: three waiting classic lobbies for the owner's visual check.
// --snapshot-browser / --restore-check: read-only observations of prepared lobbies.
// --play-browser: continue both prepared games only after the owner's UI check.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import WebSocket from 'ws';
import { findPlacements, placementError } from '@asobiba/game-jinchi';
import { jinchi } from '@asobiba/game-jinchi';
import { Match } from '@asobiba/sdk';
import { createJinchiDecoder } from '../games/jinchi/src/wire.ts';

const root = resolve(import.meta.dirname, '..');
const baseIndex = process.argv.indexOf('--base');
const base = baseIndex > 0 ? process.argv[baseIndex + 1] : 'http://localhost:8787';
const out = resolve(root, 'storage/verification/08-jinchi-playtest');
mkdirSync(out, { recursive: true });
const credentials = JSON.parse(readFileSync(resolve(root, 'storage/verify/accounts.json'), 'utf8'));
const privatePath = resolve(out, 'private-sessions.json');
const browserPath = resolve(out, 'browser-lobbies.json');
const privateState = existsSync(privatePath) ? JSON.parse(readFileSync(privatePath, 'utf8')) : {};
const publicState = existsSync(browserPath) ? JSON.parse(readFileSync(browserPath, 'utf8')) : {};
const sockets = new Set();
const observations = [];
const mcp = new Client({ name: 'verify-jinchi-playtest', version: '1.0.0' });
const save = (name, data) => writeFileSync(resolve(out, name), JSON.stringify(data, null, 2));
const note = text => { observations.push(text); console.log(`✓ ${text}`); };
const savePrivate = () => writeFileSync(privatePath, JSON.stringify(privateState, null, 2), { mode: 0o600 });
const savePublic = () => save('browser-lobbies.json', publicState);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function session(cookie) {
  return { cookie, async request(method, path, body, allowError = false) {
    const response = await fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = response.status === 204 ? null : await response.json();
    if (!allowError) assert(response.ok, `${method} ${path}: HTTP ${response.status} ${JSON.stringify(json)}`);
    return allowError ? { status: response.status, json } : json;
  } };
}
async function login(name) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials.accounts[name]) });
  assert(response.ok, `Login failed: HTTP ${response.status}`);
  return session(response.headers.get('set-cookie').split(';')[0]);
}
async function call(name, args = {}, allowError = false) {
  const start = performance.now();
  const result = await mcp.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const text = result.content.find(block => block.type === 'text')?.text ?? 'null';
  let json; try { json = JSON.parse(text); } catch { json = { text }; }
  if (!allowError) assert(!result.isError, `${name}: ${JSON.stringify(json)}`);
  return { json, content: result.content, isError: Boolean(result.isError), milliseconds: Math.round((performance.now() - start) * 10) / 10 };
}
async function waitFor(predicate, label, timeout = 30000) {
  const until = Date.now() + timeout;
  while (!predicate()) { assert(Date.now() < until, `Timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 15)); }
}
async function connect(user, id) {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`, { headers: { cookie: user.cookie } });
  sockets.add(ws);
  const decode = createJinchiDecoder();
  const state = { match: null, lobby: null, seat: null, revision: 0, errors: [], snapshots: [] };
  ws.on('message', raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'lobby') state.lobby = message.lobby;
      if (message.type === 'match') {
        const start = performance.now();
        state.match = message.match ? decode(message.match) : null; state.seat = message.seat; state.revision++;
        if (message.match) state.snapshots.push({ bytes: raw.length, packed: !Array.isArray(message.match.game?.cells), decodeMs: Math.round((performance.now() - start) * 10) / 10 });
      }
      if (message.type === 'error') state.errors.push(message);
    } catch (error) { state.errors.push({ code: 'decode', message: error.message }); }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'subscribe', lobbyId: id }));
  await waitFor(() => state.lobby || state.errors.length, 'subscription');
  assert.deepEqual(state.errors, []);
  return { ws, state };
}
async function guest(lobbyId) {
  if (privateState.guestCookie) {
    const existing = session(privateState.guestCookie);
    const me = await existing.request('GET', '/api/me');
    if (me.user?.role === 'guest') return existing;
  }
  const response = await fetch(`${base}/api/auth/guest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Проверка 08', role: 'player', lobbyId, attempt: randomBytes(24).toString('hex') }) });
  assert(response.ok, `Guest join failed: HTTP ${response.status}`);
  const user = await response.json();
  privateState.guestCookie = response.headers.get('set-cookie').split(';')[0];
  privateState.guestId = user.user.id; savePrivate();
  return session(privateState.guestCookie);
}
async function spectator(lobbyId) {
  if (privateState.spectatorCookie) {
    const existing = session(privateState.spectatorCookie);
    const me = await existing.request('GET', '/api/me');
    if (me.user?.role === 'guest') { await join(existing, lobbyId, 'spectator'); return existing; }
  }
  const response = await fetch(`${base}/api/auth/guest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Наблюдатель 08', role: 'spectator', lobbyId, attempt: randomBytes(24).toString('hex') }) });
  assert(response.ok, `Spectator join failed: HTTP ${response.status}`);
  privateState.spectatorCookie = response.headers.get('set-cookie').split(';')[0]; savePrivate();
  return session(privateState.spectatorCookie);
}
async function join(user, id, role = 'player') {
  const current = await user.request('GET', `/api/lobbies/${id}`);
  const me = await user.request('GET', '/api/me');
  if (!current.lobby.members.some(member => member.userId === me.user.id && member.role === role)) await user.request('POST', `/api/lobbies/${id}/join`, { role });
}
async function savePreview(configId, name) {
  const preview = await call('config_preview', { configId, moment: 'start', seed: 9 });
  const image = preview.content.find(block => block.type === 'image');
  assert(image, 'PNG preview missing');
  const data = Buffer.from(image.data, 'base64');
  assert.equal(data.subarray(1, 4).toString(), 'PNG');
  writeFileSync(resolve(out, `${name}.png`), data);
  return { milliseconds: preview.milliseconds, bytes: data.length, width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
async function prepare(host, second) {
  const ordinaryId = 'lob_4Rj8w0SuiA';
  await join(second, ordinaryId);
  const third = await guest(ordinaryId); await join(third, ordinaryId);
  const ordinary = (await host.request('GET', `/api/lobbies/${ordinaryId}`)).lobby;
  assert.equal(ordinary.status, 'waiting', 'Browser ordinary lobby must remain unstarted');
  assert.equal(ordinary.members.filter(member => member.role === 'player').length, 3);
  publicState.ordinary = { id: ordinaryId, url: `http://localhost:5173/lobby/${ordinaryId}`, status: ordinary.status, players: ordinary.members.map(({ role, seat, login }) => ({ role, seat, login })), summary: ordinary.information?.summary ?? null, initialView: null, firstLegalAction: null };
  savePublic(); note(`Обычное browser-лобби ${ordinaryId}: 3 игрока, старт не выполнялся`);
  if (!publicState.maximum?.id) {
    const generated = await call('jinchi_generate', { title: '08 · максимальная карта 1000 d100', request: { width: 1000, height: 1000, shape: 'rectangle', players: 3, seed: 42, dice: [100, 100], flags: { mode: 'primary', count: 9, target: 4 }, effects: { count: 9 } } });
    const configId = generated.json.configId;
    const validated = await call('config_validate', { configId }); assert(validated.json.ok);
    const created = await call('lobby_create', { name: '08 · 1000×1000, d100, три игрока', configId });
    publicState.maximum = { id: created.json.lobby.id, url: created.json.lobby.url, configId, generationMs: generated.milliseconds, validateMs: validated.milliseconds, diagnostics: generated.json.diagnostics };
    savePublic();
  }
  const maximum = publicState.maximum;
  await join(second, maximum.id); await join(third, maximum.id);
  const clients = await Promise.all([host, second, third].map(user => connect(user, maximum.id)));
  const before = performance.now();
  const lobby = (await host.request('GET', `/api/lobbies/${maximum.id}`)).lobby;
  if (lobby.status === 'waiting') await host.request('POST', `/api/lobbies/${maximum.id}/start`);
  await waitFor(() => clients.every(client => client.state.match), 'maximum initial snapshots', 60000);
  const view = clients[0].state.match;
  assert.equal(view.game.turn, 0, 'No action may be played before browser inspection');
  assert.equal(view.game.width, 1000); assert.equal(view.game.height, 1000);
  const current = clients.find(client => client.state.seat === view.currentSeats[0]);
  assert(current);
  const first = findPlacements(current.state.match.game, current.state.seat, undefined, 1)[0];
  assert(first);
  maximum.status = 'playing'; maximum.startedAndDeliveredMs = Math.round((performance.now() - before) * 10) / 10;
  maximum.initialViewFile = 'maximum-initial-view.json'; maximum.firstLegalAction = first; maximum.currentSeat = current.state.seat;
  maximum.initialPublicView = { phase: view.phase, currentSeats: view.currentSeats, width: view.game.width, height: view.game.height, turn: view.game.turn, dice: view.game.dice, scores: view.game.scores, flags: view.game.flags, effects: view.game.effects };
  maximum.snapshots = clients.map(client => ({ seat: client.state.seat, ...client.state.snapshots.at(-1) }));
  save('maximum-initial-view.json', view); savePublic();
  note(`Максимальное browser-лобби ${maximum.id}: запущено, turn=0, дальнейших действий нет`);
  save('preparation.json', { checkedAt: new Date().toISOString(), observations });
}
async function snapshotBrowser(host, second) {
  const third = await guest(publicState.ordinary.id);
  for (const label of ['ordinary', 'maximum']) {
    const item = publicState[label];
    const clients = await Promise.all([host, second, third].map(user => connect(user, item.id)));
    await waitFor(() => clients.every(client => client.state.match), `${label} public snapshot`);
    const match = clients[0].state.match;
    const current = clients.find(client => client.state.seat === match.currentSeats[0]);
    const state = current.state.match.game;
    item.status = match.phase;
    item.initialViewFile = `${label}-initial-view.json`;
    item.currentSeat = current.state.seat;
    item.firstLegalAction = !state.dice ? { type: 'roll' } : findPlacements(state, current.state.seat, undefined, 1)[0];
    item.initialPublicView = { phase: match.phase, currentSeats: match.currentSeats, width: state.width, height: state.height, turn: state.turn, dice: state.dice, scores: state.scores, flags: state.flags, effects: state.effects };
    save(`${label}-initial-view.json`, match); savePublic();
    note(`${label} snapshot: turn=${state.turn}, seat=${current.state.seat}, action=${JSON.stringify(item.firstLegalAction)}`);
    for (const client of clients) { client.ws.close(); sockets.delete(client.ws); }
  }
}
async function restoredBrowser(host) {
  const evidence = { checkedAt: new Date().toISOString(), reloadReason: 'Root reported tsx server reload after the info.ts correction', lobbies: {} };
  for (const label of ['ordinary', 'maximum']) {
    const item = publicState[label];
    const before = JSON.parse(readFileSync(resolve(out, item.initialViewFile), 'utf8'));
    const client = await connect(host, item.id);
    await waitFor(() => client.state.match, `${label} restored snapshot`);
    const after = client.state.match;
    const same = before.game.turn === after.game.turn && hash(before.game.cells) === hash(after.game.cells) && JSON.stringify(before.game.dice) === JSON.stringify(after.game.dice);
    if (label === 'maximum') assert(same, 'Maximum untouched browser state changed across server reload');
    evidence.lobbies[label] = { lobbyId: item.id, beforeTurn: before.game.turn, afterTurn: after.game.turn, sameCellsAndDice: same, cellsHash: hash(after.game.cells), replay: replayStored(item.id, after), packet: client.state.snapshots.at(-1) };
    client.ws.close(); sockets.delete(client.ws);
  }
  save('server-restore-after-reload.json', evidence);
  note('После фактического server reload: max initial cells/dice/turn сохранены; оба живых состояния совпали с журналами');
}
async function prepareInformation() {
  publicState.infoLobbies ??= {};
  for (const gameId of ['tic-tac-toe', 'russkoe-pole', 'quizor']) {
    if (!publicState.infoLobbies[gameId]) {
      const caps = (await call('game_capabilities', { gameId })).json;
      const preset = caps.presetConfigs.find(preset => preset.id === 'classic');
      assert(preset, `Classic preset missing: ${gameId}`);
      const created = await call('lobby_create', { name: `08 info · ${caps.title}`, config: preset.config });
      publicState.infoLobbies[gameId] = { id: created.json.lobby.id, url: created.json.lobby.url, preset: 'classic', status: 'waiting' };
      savePublic();
    }
    note(`Общее info: ${gameId} → ${publicState.infoLobbies[gameId].url}, без старта`);
  }
}

async function rejectAction(client, id, action, expectedCode, others) {
  const previous = client.state.errors.length;
  const turns = others.map(other => other.state.match.game.turn);
  client.ws.send(JSON.stringify({ type: 'action', lobbyId: id, action }));
  await waitFor(() => client.state.errors.length > previous, 'rejected action');
  assert.equal(client.state.errors.at(-1).code, expectedCode);
  assert.deepEqual(others.map(other => other.state.match.game.turn), turns);
  const error = client.state.errors.pop();
  return { code: error.code, message: error.message };
}
function replayStored(id, liveView) {
  // Read only: use the real persisted journal without restarting root's browser server.
  const database = new DatabaseSync(resolve(root, 'storage/asobiba.db'), { readOnly: true });
  try {
    const row = database.prepare('SELECT m.seed,m.startedAt,m.finishedAt,m.seatUsers,m.log,l.config FROM "Match" m JOIN "Lobby" l ON l.id=m.lobbyId WHERE m.lobbyId=? ORDER BY m.startedAt DESC LIMIT 1').get(id);
    assert(row, 'Persisted match missing');
    const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
    const record = { seed: row.seed, startedAt: Number.isFinite(Number(row.startedAt)) ? Number(row.startedAt) : new Date(row.startedAt).getTime(), seats: parse(row.seatUsers).length, log: parse(row.log) };
    const now = row.finishedAt ? Number.isFinite(Number(row.finishedAt)) ? Number(row.finishedAt) : new Date(row.finishedAt).getTime() : Date.now();
    const restored = Match.restore({ game: jinchi, config: parse(row.config), record, now });
    const expected = { ...liveView, game: { ...liveView.game, canAct: false, canReroll: false, canSkip: false } };
    assert.deepEqual(restored.view(null), expected);
    return { exact: true, journalActions: record.log.length, cellsHash: hash(expected.game.cells), result: restored.view(null).result, serverRestarted: false };
  } finally { database.close(); }
}
async function playLobby(host, second, third, id, label, actionLimit = 5000) {
  const viewer = await spectator(id);
  const users = [host, second, third];
  const clients = await Promise.all(users.map(user => connect(user, id)));
  const observer = await connect(viewer, id);
  const lobby = (await host.request('GET', `/api/lobbies/${id}`)).lobby;
  if (lobby.status === 'waiting') await host.request('POST', `/api/lobbies/${id}/start`);
  await waitFor(() => [...clients, observer].every(client => client.state.match), `${label} start`);
  assert.equal(observer.state.seat, null); assert.equal(observer.state.match.game.canAct, false);
  const firstCurrent = clients.find(client => client.state.seat === clients[0].state.match.currentSeats[0]);
  const firstState = firstCurrent.state.match.game;
  const firstAction = !firstState.dice ? { type: 'roll' } : findPlacements(firstState, firstCurrent.state.seat, undefined, 1)[0];
  const denied = await rejectAction(observer, id, firstAction, 'not_a_player', clients);
  const wrong = clients.find(client => client !== firstCurrent);
  const wrongTurn = await rejectAction(wrong, id, firstAction, 'not_your_turn', clients);
  const initial = clients[0].state.match.game;
  const flagTotal = initial.flags.length + initial.flagCounts.reduce((sum, count) => sum + count, 0);
  const objectKinds = new Set(), eventTypes = new Set(), rerolledSeats = new Set();
  const consumedEffects = new Set();
  const actionLog = [], latency = [];
  let reconnected = false, actions = 0, priorEffects = [...initial.effects];
  while (clients[0].state.match.phase === 'playing' && actions < actionLimit) {
    const currentSeat = clients[0].state.match.currentSeats[0];
    const current = clients.find(client => client.state.seat === currentSeat);
    assert(current, 'Current seat has no authenticated WebSocket');
    const view = current.state.match.game;
    for (const client of clients) assert.equal(client.state.match.game.canAct, client.state.seat === currentSeat);
    assert.equal(observer.state.match.game.canAct, false);
    let action;
    if (!view.dice) action = { type: 'roll' };
    else if (view.canReroll && !rerolledSeats.has(currentSeat)) { action = { type: 'reroll' }; rerolledSeats.add(currentSeat); }
    else if (view.canSkip) action = { type: 'skip-impossible' };
    else {
      const legal = findPlacements(view, currentSeat, undefined, 2048);
      assert(legal.length, 'No legal rectangle and no supported impossible-roll action');
      const score = choice => {
        const width = view.dice[choice.rotated ? 1 : 0], height = view.dice[choice.rotated ? 0 : 1];
        const within = cell => cell.x >= choice.x && cell.y >= choice.y && cell.x < choice.x + width && cell.y < choice.y + height;
        return view.effects.filter(within).reduce((sum, effect) => sum + (effect.kind === 'reroll' && !rerolledSeats.has(currentSeat) ? 30 : 10), 0) + view.flags.filter(within).length * 20;
      };
      action = legal.reduce((best, choice) => score(choice) > score(best) ? choice : best);
    }
    const all = [...clients, observer], revisions = all.map(client => client.state.revision);
    const before = performance.now();
    current.ws.send(JSON.stringify({ type: 'action', lobbyId: id, action }));
    await waitFor(() => all.every((client, index) => client.state.revision > revisions[index]) || all.some(client => client.state.errors.length), `${label} action broadcast`);
    assert.deepEqual(all.flatMap(client => client.state.errors), []);
    latency.push(Math.round((performance.now() - before) * 10) / 10);
    actions++; actionLog.push({ seat: currentSeat, action, ms: latency.at(-1) });
    const state = clients[0].state.match.game;
    const stateHash = hash(state.cells);
    assert(all.every(client => hash(client.state.match.game.cells) === stateHash), 'Decoded boards disagree');
    assert.equal(state.flags.length + state.flagCounts.reduce((sum, count) => sum + count, 0), flagTotal, 'One-shot flag invariant');
    assert(state.rerollCharges.every(charges => charges >= 0 && charges <= 3));
    for (const event of state.events) eventTypes.add(event.type);
    for (const effect of priorEffects) {
      const key = `${effect.x}:${effect.y}`;
      if (!state.effects.some(other => other.x === effect.x && other.y === effect.y)) { consumedEffects.add(key); objectKinds.add(effect.kind); }
    }
    for (const effect of state.effects) assert(!consumedEffects.has(`${effect.x}:${effect.y}`), 'Consumed effect reappeared');
    priorEffects = [...state.effects];
    const counts = state.scores.map(() => 0);
    for (const cell of state.cells) if (cell >= 0) counts[cell]++;
    assert.deepEqual(state.scores, counts);
    if (!reconnected && actions >= 5 && clients[0].state.match.phase === 'playing') {
      clients[1].ws.close(); sockets.delete(clients[1].ws);
      clients[1] = await connect(second, id);
      await waitFor(() => clients[1].state.match, 'reconnected snapshot');
      assert.equal(hash(clients[1].state.match.game.cells), stateHash);
      reconnected = true;
    }
  }
  const final = clients[0].state.match;
  assert.equal(final.phase, 'finished', `${label} exceeded ${actionLimit} verification actions`);
  const replay = replayStored(id, observer.state.match);
  const sorted = [...latency].sort((a, b) => a - b);
  const result = { lobbyId: id, startingTurn: initial.turn, actions, previouslyRecordedActions: replay.journalActions - actions, latencyMs: { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)], maximum: sorted.at(-1) }, denied, wrongTurn, reconnected, eventTypes: [...eventTypes], activatedKinds: [...objectKinds], rerolledSeats: [...rerolledSeats], flagsCollected: final.game.flagCounts, effectsConsumed: consumedEffects.size, result: final.result, lastRound: final.lastRound, replay, packets: clients.map(client => ({ seat: client.state.seat, count: client.state.snapshots.length, packed: client.state.snapshots.every(snapshot => snapshot.packed), maxBytes: Math.max(...client.state.snapshots.map(snapshot => snapshot.bytes)) })), randomSmokeIsBalanceProof: false };
  save(`${label}-live.json`, { ...result, actionLog }); save(`${label}-final-view.json`, observer.state.match);
  for (const client of [...clients, observer]) { client.ws.close(); sockets.delete(client.ws); }
  note(`${label}: 3 WS + spectator, ${actions} действий, итог ${final.lastRound?.reason}, replay/reconnect совпали`);
  return result;
}

async function independent(host, second) {
  const result = { checkedAt: new Date().toISOString(), capabilities: [], negatives: {}, chains: {}, findings: [], observations };
  try {
    for (const gameId of ['jinchi', 'tic-tac-toe', 'russkoe-pole', 'quizor']) {
      const caps = (await call('game_capabilities', { gameId })).json;
      assert(caps.info?.overview && caps.info.goal && caps.info.turn && caps.info.example);
      assert(caps.tuning.length >= 5 && caps.tuning.length <= 7);
      assert(caps.tuning.every(direction => direction.options.length && direction.options.every(option => option.consequence)));
      const validation = await call('config_validate', { config: caps.presetConfigs[0].config }); assert(validation.json.ok);
      const record = { gameId, version: caps.version, info: caps.info, tuning: caps.tuning, summary: validation.json.summary, issues: validation.json.issues };
      result.capabilities.push(record); save(`capabilities-${gameId}.json`, record);
    }
    note('MCP capabilities всех 4 игр: info и 5–7 направлений; реальные config summaries');
    for (const [label, request, configId] of [
      ['ordinary', { radius: 50, players: 3, seed: 42, flags: { mode: 'bonus', count: 9 }, effects: { count: 9 } }, null],
      ['maximum', null, publicState.maximum.configId],
    ]) {
      const generation = configId ? null : await call('jinchi_generate', { title: `08 protocol ${label}`, request });
      const reference = configId ?? generation.json.configId;
      if (generation) { assert(!('config' in generation.json)); assert(JSON.stringify(generation.json).length < 20000); }
      const validation = await call('config_validate', { configId: reference }); assert(validation.json.ok); assert(!('config' in validation.json));
      const simulation = await call('config_simulate', { configId: reference, rounds: 1 });
      assert(!simulation.json.issues.some(issue => ['stuck', 'illegal-legal-action'].includes(issue.code)));
      const preview = await savePreview(reference, `${label}-start`);
      const chain = { configId: reference, generationMs: generation?.milliseconds ?? publicState.maximum.generationMs, validationMs: validation.milliseconds, simulationMs: simulation.milliseconds, simulation: simulation.json, preview, summary: validation.json.summary, diagnostics: generation?.json.diagnostics ?? publicState.maximum.diagnostics, randomSmokeIsBalanceProof: false };
      result.chains[label] = chain;
      if (label === 'ordinary') {
        const created = await call('lobby_create', { name: '08 protocol strict disposable', configId: reference });
        const strict = await host.request('POST', `/api/lobbies/${created.json.lobby.id}/start`, undefined, true);
        assert.equal(strict.status, 409); chain.strictStart = strict.json;
        const foreign = await second.request('GET', `/api/configs/${reference}`, undefined, true); assert([403, 404].includes(foreign.status));
        result.negatives.foreignConfig = { status: foreign.status, error: foreign.json.error };
        await host.request('POST', `/api/lobbies/${created.json.lobby.id}/close`);
      }
      note(`MCP ${label}: компактный configId → validate → simulate → PNG${label === 'ordinary' ? ' → strict lobby' : ''}`);
    }
    const invalid = await call('jinchi_generate', { request: { width: 1001, height: 1000, players: 3 } }, true); assert(invalid.isError);
    const tooLargeDice = await call('jinchi_generate', { request: { width: 15, height: 15, players: 3, dice: [100, 100] } }, true); assert(tooLargeDice.isError);
    const ambiguous = await call('config_validate', { configId: publicState.maximum.configId, config: {} }, true); assert(ambiguous.isError);
    result.negatives.dimensions1001 = invalid.json; result.negatives.impossibleDice = tooLargeDice.json; result.negatives.ambiguousReference = ambiguous.json;
    const web = await host.request('POST', '/api/games/jinchi/generate', { request: { radius: 30, players: 3, seed: 7, dice: [6, 20] } });
    assert.deepEqual(web.config.rules.dice.sides, [6, 20]); assert(web.diagnostics.balanced); result.httpMixedDice = { summary: web.summary, diagnostics: web.diagnostics };
    const rows = ['1.....2', '.......', '.......', '.......', '.......', '.......', '...3...'];
    const config = { sdk: 1, game: 'jinchi', gameVersion: 1, title: '08 WS objects smoke', rules: { map: { width: 7, height: 7, rows }, starts: { assignment: 'ordered' }, dice: { sides: 2, roll: 'manual' }, flags: { mode: 'bonus', value: 25, positions: [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 3 }, { x: 1, y: 3 }, { x: 5, y: 3 }, { x: 2, y: 4 }, { x: 4, y: 4 }] }, effects: { cells: [{ x: 1, y: 0, kind: 'reroll' }, { x: 0, y: 1, kind: 'reroll' }, { x: 5, y: 0, kind: 'reroll' }, { x: 6, y: 1, kind: 'reroll' }, { x: 2, y: 6, kind: 'reroll' }, { x: 4, y: 6, kind: 'reroll' }, { x: 3, y: 5, kind: 'reroll' }, { x: 1, y: 1, kind: 'cache', value: 25 }, { x: 5, y: 1, kind: 'trap', value: 15 }, { x: 2, y: 5, kind: 'lock' }, { x: 4, y: 5, kind: 'mystery' }] }, end: { maxRounds: 8 } }, timer: { turnSeconds: 0, onTimeout: 'skip' } };
    const validation = await call('config_validate', { config }); assert(validation.json.ok);
    const created = await call('lobby_create', { name: '08 WS flags/effects disposable', config });
    const third = await guest(created.json.lobby.id); await join(second, created.json.lobby.id); await join(third, created.json.lobby.id);
    result.smallMatch = await playLobby(host, second, third, created.json.lobby.id, 'small-objects', 500);
    assert(result.smallMatch.rerolledSeats.length > 0); assert(result.smallMatch.flagsCollected.some(count => count > 0)); assert(result.smallMatch.effectsConsumed > 0);
    await host.request('POST', `/api/lobbies/${created.json.lobby.id}/close`);
    save('protocol-report.json', result);
  } catch (error) { result.failure = { message: error.message, stack: error.stack }; save('protocol-report.json', result); throw error; }
}

async function heavyCapture(host, second) {
  const side = 1000;
  const rows = Array.from({ length: side }, (_, y) => '.'.repeat(499) + (y === 500 ? '.' : '1') + '.'.repeat(500));
  rows[0] = rows[0].slice(0, 998) + '3.';
  rows[998] = rows[998].slice(0, 998) + '2.';
  const config = { sdk: 1, game: 'jinchi', gameVersion: 1, title: '08 тяжёлое окружение 499000', rules: { map: { width: side, height: side, rows }, dice: { sides: 100, roll: 'manual' }, starts: { assignment: 'ordered' }, placement: { overlapOwn: true }, flags: { mode: 'primary', target: 1, positions: [{ x: 100, y: 100 }, { x: 700, y: 700 }, { x: 800, y: 800 }] }, effects: { cells: [{ x: 200, y: 200, kind: 'cache', value: 25 }, { x: 300, y: 300, kind: 'trap', value: 15 }, { x: 400, y: 400, kind: 'reroll' }, { x: 250, y: 250, kind: 'mystery' }] } }, timer: { turnSeconds: 0, onTimeout: 'skip' } };
  const validation = await call('config_validate', { config }); assert(validation.json.ok);
  const created = await call('lobby_create', { name: '08 stress capture disposable', config });
  const id = created.json.lobby.id;
  const third = await guest(id); await join(second, id); await join(third, id);
  const observerUser = await spectator(id);
  const clients = await Promise.all([host, second, third, observerUser].map(user => connect(user, id)));
  const started = performance.now();
  await host.request('POST', `/api/lobbies/${id}/start`);
  await waitFor(() => clients.every(client => client.state.match), 'stress initial snapshots');
  const startMs = Math.round((performance.now() - started) * 10) / 10;
  const current = clients.find(client => client.state.seat === 0);
  async function dispatch(action) {
    const revisions = clients.map(client => client.state.revision);
    const before = performance.now();
    current.ws.send(JSON.stringify({ type: 'action', lobbyId: id, action }));
    await waitFor(() => clients.every((client, i) => client.state.revision > revisions[i]) || clients.some(client => client.state.errors.length), 'stress action delivery');
    assert.deepEqual(clients.flatMap(client => client.state.errors), []);
    return Math.round((performance.now() - before) * 10) / 10;
  }
  await dispatch({ type: 'roll' });
  const dice = current.state.match.game.dice;
  const action = { type: 'place', x: 499, y: 500, rotated: false };
  assert.equal(placementError(current.state.match.game, 0, action.x, action.y, false), null);
  const captureMs = await dispatch(action);
  const final = clients[3].state.match;
  assert.equal(final.phase, 'finished'); assert.equal(final.lastRound.reason, 'flag-target');
  assert.equal(final.game.lastMove.captured.length, 499000);
  assert.deepEqual(final.game.flagCounts, [1, 0, 0]);
  assert.equal(final.game.effects.length, 0);
  assert(clients.every(client => hash(client.state.match.game.cells) === hash(final.game.cells)));
  assert(clients.every(client => client.state.snapshots.every(snapshot => snapshot.packed)));
  const result = { lobbyId: id, map: [1000, 1000], dice, startMs, captureMs, captured: final.game.lastMove.captured.length, flags: final.game.flagCounts, effectPoints: final.game.effectPoints, rerollCharges: final.game.rerollCharges, lastRound: final.lastRound, replay: replayStored(id, final), snapshots: clients.map(client => ({ seat: client.state.seat, ...client.state.snapshots.at(-1) })), note: 'Намеренно асимметричная ручная stress-карта; не доказательство стратегического баланса.' };
  save('heavy-capture.json', result); save('heavy-final-view.json', final);
  await host.request('POST', `/api/lobbies/${id}/close`);
  for (const client of clients) { client.ws.close(); sockets.delete(client.ws); }
  note(`Stress: ${result.captured} клеток, ${captureMs} мс до 3 игроков и наблюдателя, packed/replay точны`);
}

try {
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${credentials.mcpToken}` } } }));
  const [host, second] = await Promise.all([login('verify-a'), login('verify-b')]);
  if (process.argv.includes('--prepare-info')) await prepareInformation();
  else if (process.argv.includes('--restore-check')) await restoredBrowser(host);
  else if (process.argv.includes('--stress')) await heavyCapture(host, second);
  else if (process.argv.includes('--snapshot-browser')) await snapshotBrowser(host, second);
  else if (process.argv.includes('--independent')) await independent(host, second);
  else if (process.argv.includes('--play-browser')) {
    const third = await guest(publicState.ordinary.id);
    for (const label of ['ordinary', 'maximum']) {
      const result = await playLobby(host, second, third, publicState[label].id, `${label}-browser`);
      publicState[label].status = 'finished'; publicState[label].result = result.result; publicState[label].lastRound = result.lastRound;
      publicState[label].finalViewFile = `${label}-browser-final-view.json`; savePublic();
    }
  } else await prepare(host, second);
} finally {
  for (const ws of sockets) ws.close();
  await mcp.close();
}
