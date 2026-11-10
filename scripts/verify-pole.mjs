#!/usr/bin/env node
// Live check for Русское поле: MCP capabilities, a secret-safe preview, and a
// WebSocket match whose view never contains the answer before it is opened.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import WebSocket from "ws";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const root = resolve(import.meta.dirname, "..");
const base = arg("base", "http://127.0.0.1:8787");
const out = resolve(root, arg("out", "storage/verification/04-russkoe-pole"));
mkdirSync(out, { recursive: true });
const { accounts, mcpToken } = JSON.parse(readFileSync(resolve(root, "storage/verify/accounts.json"), "utf8"));
const step = (msg) => console.log(`✓ ${msg}`);

const client = new Client({ name: "verify-pole", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } } }));
const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.find((c) => c.type === "text")?.text ?? "null";
  if (res.isError) throw new Error(`${name}: ${text}`);
  return { json: JSON.parse(text), content: res.content };
};

const caps = (await call("game_capabilities", { gameId: "russkoe-pole" })).json;
if (caps.presetConfigs.length < 6) throw new Error(`presets ${caps.presetConfigs.length}`);
step(`capabilities: ${caps.presetConfigs.length} presets`);
const classic = structuredClone(caps.presetConfigs.find((p) => p.id === "classic").config);
const validated = (await call("config_validate", { config: classic })).json;
if (!validated.ok) throw new Error(JSON.stringify(validated.issues));
step("config_validate classic");
const sim = (await call("config_simulate", { config: classic, rounds: 2 })).json;
const blocking = (sim.issues ?? []).filter((issue) => ["stuck", "never-ends", "illegal-legal-action"].includes(issue.code));
if (blocking.length) throw new Error(JSON.stringify(blocking));
step(`config_simulate finished ${sim.finished}/${sim.rounds}`);
for (const moment of ["start", "end"]) {
  const preview = await call("config_preview", { config: classic, moment, seed: 3 });
  const image = preview.content.find((c) => c.type === "image");
  if (!image?.data) throw new Error(`no png for ${moment}`);
  const file = resolve(out, `preview-${moment}.png`);
  writeFileSync(file, Buffer.from(image.data, "base64"));
  if (preview.json && JSON.stringify(preview.json).includes("ХРИЗОЛИТ")) throw new Error("preview text leaked the canary");
  step(`preview ${moment} ${file}`);
}
await client.close();

async function login(name) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(accounts[name]) });
  if (!res.ok) throw new Error(`login ${name}`);
  return res.headers.get("set-cookie").split(";")[0];
}
const cookie = await login("verify-a");
const api = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};
const games = await api("GET", "/api/games/russkoe-pole");
const solo = structuredClone(games.game.presetConfigs.find((p) => p.id === "solo").config);
solo.rules.words = { source: "custom", themes: ["priroda"], rounds: 1, custom: [{ question: "Кто мурлычет", answer: "КОТ" }] };
solo.rules.wheel = [
  { type: "points", value: 100 },
  { type: "points", value: 200 },
  { type: "points", value: 300 },
  { type: "points", value: 400 },
];
solo.rules.super = { ...solo.rules.super, enabled: false };
solo.title = "Проверка поля";
const { lobby } = await api("POST", "/api/lobbies", { name: "Проверка поля", config: solo });
if (JSON.stringify(lobby.config).includes("КОТ")) throw new Error("lobby config leaked the answer");
step("lobby config hides КОТ");
await api("POST", `/api/lobbies/${lobby.id}/start`);
const ws = new WebSocket(`${base.replace(/^http/, "ws")}/ws`, { headers: { cookie } });
await new Promise((resolve, reject) => (ws.once("open", resolve), ws.once("error", reject)));
const state = { match: null, errors: [] };
ws.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "match") state.match = message.match;
  if (message.type === "error") state.errors.push(message.code);
});
ws.send(JSON.stringify({ type: "subscribe", lobbyId: lobby.id }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred) => {
  for (let i = 0; i < 20; i++) {
    if (pred()) return;
    await wait(100);
  }
  throw new Error(`timeout phase ${state.match?.game?.phase} errors ${state.errors.join(",")}`);
};
await until(() => state.match?.game?.question === "Кто мурлычет");
const before = JSON.stringify(state.match.game);
if (before.includes("КОТ")) throw new Error("match view leaked the answer");
ws.send(JSON.stringify({ type: "action", lobbyId: lobby.id, action: { type: "spin" } }));
await until(() => state.match.game.phase === "guess");
if (JSON.stringify(state.match.game).includes("КОТ")) throw new Error("guess view leaked the answer");
ws.send(JSON.stringify({ type: "action", lobbyId: lobby.id, action: { type: "solve", text: "кот" } }));
await until(() => state.match.phase === "finished" || state.match.game.phase === "done");
ws.close();
if (state.match.phase !== "finished") throw new Error(`phase ${state.match.phase} game ${state.match.game.phase} errors ${state.errors}`);
step(`websocket finished, winners ${JSON.stringify(state.match.result?.winners)}`);
writeFileSync(resolve(out, "ws-result.json"), JSON.stringify({ phase: state.match.phase, result: state.match.result, question: state.match.game.question }, null, 2));
