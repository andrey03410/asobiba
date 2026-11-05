#!/usr/bin/env -S node --import tsx
// Live Jinchi QG. Run after seed-verify against a running dev server:
// node --import tsx scripts/verify-jinchi.mjs [--base http://127.0.0.1:8787]
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import WebSocket from 'ws';
import { findPlacements } from '@asobiba/game-jinchi';

const root = resolve(import.meta.dirname, '..');
const flag = process.argv.indexOf('--base');
const base = flag > 0 ? process.argv[flag + 1] : 'http://127.0.0.1:8787';
const out = resolve(root, 'storage/verification/02-jinchi');
mkdirSync(out, { recursive: true });
const { accounts, mcpToken } = JSON.parse(readFileSync(resolve(root, 'storage/verify/accounts.json'), 'utf8'));
const observations = [];
const note = value => { observations.push(value); console.log(`✓ ${value}`); };
const mcp = new Client({ name: 'verify-jinchi', version: '1.0.0' });
const sockets = [];
async function call(name, args = {}) {
  const result = await mcp.callTool({ name, arguments: args });
  const message = result.content.find(c => c.type === 'text')?.text ?? 'null';
  assert(!result.isError, `${name}: ${message}`);
  return { json: JSON.parse(message), content: result.content };
}
async function login(name) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(accounts[name]) });
  assert(r.ok, `login ${name}: ${r.status}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return { cookie, async request(method, path, body) {
    const response = await fetch(`${base}${path}`, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = response.status === 204 ? null : await response.json();
    assert(response.ok, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  } };
}
async function waitFor(fn, label) {
  const until = Date.now() + 15000;
  while (!fn()) {
    assert(Date.now() < until, `Timed out: ${label}`);
    await new Promise(r => setTimeout(r, 20));
  }
}
async function connect(user, id) {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`, { headers: { cookie: user.cookie } });
  sockets.push(ws);
  const state = { match: null, revision: 0, errors: [], seat: null };
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'match') { state.match = message.match; state.seat = message.seat; state.revision++; }
    if (message.type === 'error') state.errors.push(message);
  });
  await new Promise((r, reject) => { ws.once('open', r); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'subscribe', lobbyId: id }));
  return { ws, state };
}
try {
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } } }));
  const games = (await call('games_list')).json;
  assert(JSON.stringify(games).includes('jinchi'));
  const caps = (await call('game_capabilities', { gameId: 'jinchi' })).json;
  assert.equal(caps.presetConfigs.length, 6);
  note(`MCP: Jinchi, ${caps.presetConfigs.length} presets, version ${caps.version}`);
  const config = caps.presetConfigs[0].config;
  const validation = (await call('config_validate', { config })).json;
  assert(validation.ok);
  const simulation = (await call('config_simulate', { config, rounds: 20 })).json;
  assert.equal(simulation.finished, 20);
  note(`MCP simulation: ${simulation.finished}/20 finished, ${simulation.averageActions} average actions`);
  for (const moment of ['start', 'end']) {
    const preview = await call('config_preview', { config, moment, seed: 9 });
    const png = preview.content.find(c => c.type === 'image');
    assert(png, 'PNG image missing');
    writeFileSync(resolve(out, `jinchi-${moment}.png`), Buffer.from(png.data, 'base64'));
  }
  note('MCP previews: start and end PNG');
  const saved = (await call('config_save', { config })).json.config;
  const lobby = (await call('lobby_create', { name: 'Jinchi · живая проверка', configId: saved.id })).json.lobby;
  const users = await Promise.all([login('verify-a'), login('verify-b')]);
  await users[1].request('POST', `/api/lobbies/${lobby.id}/join`, { role: 'player' });
  const clients = await Promise.all(users.map(u => connect(u, lobby.id)));
  await users[0].request('POST', `/api/lobbies/${lobby.id}/start`);
  await waitFor(() => clients.every(c => c.state.match), 'start match');
  // The UI and the SDK expose only ordinary human placement/roll actions.
  let actions = 0;
  let rotated = false;
  const eventTypes = new Set();
  while (clients[0].state.match.phase === 'playing' && actions < 5000) {
    const view = clients[0].state.match;
    const currentSeat = view.currentSeats[0];
    const client = clients.find(c => c.state.seat === currentSeat);
    assert(client, 'current seat has no websocket');
    const state = client.state.match.game;
    for (const event of state.events) eventTypes.add(event.type);
    const placements = findPlacements(state, currentSeat);
    const action = !state.dice ? { type: 'roll' } : placements.find(p => !rotated && p.rotated) ?? placements[0];
    assert(action, 'live round has no action');
    if (action.rotated) rotated = true;
    const revisions = clients.map(c => c.state.revision);
    client.ws.send(JSON.stringify({ type: 'action', lobbyId: lobby.id, action }));
    await waitFor(() => clients.every((c, i) => c.state.revision > revisions[i]) || clients.some(c => c.state.errors.length), 'action broadcast');
    assert.deepEqual(clients.flatMap(c => c.state.errors), []);
    actions++;
  }
  const final = clients[0].state.match;
  for (const event of final.game.events) eventTypes.add(event.type);
  assert.equal(final.phase, 'finished');
  assert.deepEqual(clients[0].state.match.game.cells, clients[1].state.match.game.cells);
  note(`WebSocket: ${actions} human actions, rotated=${rotated}, events=${[...eventTypes].join(',')}, end=${final.lastRound?.reason}`);
  writeFileSync(resolve(out, 'live-result.json'), JSON.stringify({ lobby: lobby.url, actions, rotated, eventTypes: [...eventTypes], result: final.result, lastRound: final.lastRound, simulation, observations }, null, 2));
  await users[0].request('POST', `/api/lobbies/${lobby.id}/start`);
  await waitFor(() => clients[0].state.match.phase === 'playing', 'rematch');
  note('Rematch started successfully');
  await users[0].request('POST', `/api/lobbies/${lobby.id}/close`);
} finally {
  for (const ws of sockets) ws.close();
  await mcp.close();
}
