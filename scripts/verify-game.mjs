#!/usr/bin/env node
// Live match check: verify-a and verify-b log in over HTTP, create a lobby,
// connect over WebSocket and play classic tic-tac-toe to a win.
// Needs a running server and scripts/seed-verify.ts. Usage: node scripts/verify-game.mjs [--base http://127.0.0.1:8787]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket from "ws";

const i = process.argv.indexOf("--base");
const base = i > 0 ? process.argv[i + 1] : (process.env.BASE ?? "http://127.0.0.1:8787");
const root = resolve(import.meta.dirname, "..");
const { accounts } = JSON.parse(readFileSync(resolve(root, "storage/verify/accounts.json"), "utf8"));

async function login(name) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(accounts[name]) });
  if (!res.ok) throw new Error(`login ${name}: ${res.status}`);
  const cookie = res.headers.get("set-cookie").split(";")[0];
  return async (method, path, body) => {
    const r = await fetch(`${base}${path}`, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = r.status === 204 ? null : await r.json();
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(json)}`);
    return json;
  };
}
const a = await login("verify-a");
const b = await login("verify-b");
const games = await a("GET", "/api/games/tic-tac-toe");
const classic = games.game.presetConfigs.find((p) => p.id === "classic").config;
const { lobby } = await a("POST", "/api/lobbies", { name: "Проверка партии", config: classic });
await b("POST", `/api/lobbies/${lobby.id}/join`, { role: "player" });
console.log(`✓ lobby ${lobby.url}`);

async function connect(name) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(accounts[name]) });
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/ws`, { headers: { cookie } });
  await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
  const state = { match: null, errors: [] };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "match") state.match = m.match;
    if (m.type === "error") state.errors.push(m.code);
  });
  ws.send(JSON.stringify({ type: "subscribe", lobbyId: lobby.id }));
  return { ws, state };
}
const ca = await connect("verify-a");
const cb = await connect("verify-b");
await a("POST", `/api/lobbies/${lobby.id}/start`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(300);
const moves = [[ca, 0, 0], [cb, 1, 0], [ca, 0, 1], [cb, 1, 1], [ca, 0, 2]];
for (const [c, row, col] of moves) {
  c.ws.send(JSON.stringify({ type: "action", lobbyId: lobby.id, action: { type: "place", row, col } }));
  await wait(250);
}
const m = cb.state.match;
console.log(`✓ phase ${m.phase}, result ${JSON.stringify(m.result)}, errors a=${ca.state.errors} b=${cb.state.errors}`);
ca.ws.close();
cb.ws.close();
if (m.phase !== "finished" || m.result?.winners?.[0] !== 0) process.exit(1);
