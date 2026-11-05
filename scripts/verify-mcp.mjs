#!/usr/bin/env node
// Live MCP check: a real Streamable HTTP client walks the agent recipe with the
// verify-a token: capabilities → own SVG piece → config → validate → simulate →
// PNG preview → save → lobby. Needs a running server and scripts/seed-verify.ts.
// Usage: node scripts/verify-mcp.mjs [--base http://127.0.0.1:8787] [--out storage/verification/<run>]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const root = resolve(import.meta.dirname, "..");
const base = arg("base", process.env.BASE ?? "http://127.0.0.1:8787");
const out = resolve(root, arg("out", `storage/verification/mcp-${new Date().toISOString().replace(/[:.]/g, "-")}`));
mkdirSync(out, { recursive: true });
const { mcpToken } = JSON.parse(readFileSync(resolve(root, "storage/verify/accounts.json"), "utf8"));

const client = new Client({ name: "verify-mcp", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } } }));
const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.find((c) => c.type === "text")?.text ?? "null";
  if (res.isError) throw new Error(`${name}: ${text}`);
  return { json: JSON.parse(text), content: res.content };
};
const step = (msg) => console.log(`✓ ${msg}`);

const tools = await client.listTools();
step(`tools/list: ${tools.tools.length} tools, instructions ${client.getInstructions()?.length ?? 0} chars`);
const caps = (await call("game_capabilities", { gameId: "tic-tac-toe" })).json;
step(`capabilities: ${caps.presetConfigs.length} presets, ${caps.slots.length} slots, ${Object.keys(caps.visualCatalog.pieces).length} piece presets`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <circle cx="128" cy="136" r="96" fill="#ffb3c7" stroke="#8a2846" stroke-width="10"/>
  <circle cx="92" cy="118" r="18" fill="#fff" stroke="#8a2846" stroke-width="6"/><circle cx="98" cy="122" r="8" fill="#1e1e2e"/>
  <circle cx="164" cy="118" r="18" fill="#fff" stroke="#8a2846" stroke-width="6"/><circle cx="158" cy="122" r="8" fill="#1e1e2e"/>
  <path d="M92 172 Q128 204 164 172" stroke="#8a2846" stroke-width="10" fill="none" stroke-linecap="round"/>
  <path d="M60 64 L84 30 L104 62 Z M196 64 L172 30 L152 62 Z" fill="#ffb3c7" stroke="#8a2846" stroke-width="8" stroke-linejoin="round"/>
</svg>`;
const asset = (await call("asset_create_svg", { name: "розовый кот", svg })).json.asset;
step(`asset_create_svg: ${asset.id} ${asset.width}×${asset.height}`);

const party = caps.presetConfigs.find((p) => p.id === "party").config;
const config = {
  ...party,
  title: "Смешная вечеринка",
  rules: { ...party.rules, board: { width: 6, height: 6, blocked: [[0, 0], [5, 5]] }, win: { ...party.rules.win, line: 4 } },
  visual: { theme: "party", pieces: [{ asset: asset.id }, { preset: "ghost", color: "#6c5ce7" }], animations: { place: { preset: "bounce", intensity: 1.6 }, win: { preset: "confetti" } } },
};
const validated = (await call("config_validate", { config })).json;
if (!validated.ok) throw new Error(JSON.stringify(validated.issues));
step(`config_validate: ok, warnings ${validated.issues.length}`);
const sim = (await call("config_simulate", { config, rounds: 100 })).json;
step(`config_simulate: finished ${sim.finished}/${sim.rounds}, draws ${sim.draws}, wins ${sim.winsBySeat.join("/")}, issues ${sim.issues.map((i) => i.code).join(",") || "none"}`);
for (const moment of ["start", "end"]) {
  const preview = await call("config_preview", { config, moment, seed: 5 });
  const image = preview.content.find((c) => c.type === "image");
  writeFileSync(resolve(out, `preview-${moment}.png`), Buffer.from(image.data, "base64"));
  step(`config_preview ${moment}: ${resolve(out, `preview-${moment}.png`)}`);
}
const saved = (await call("config_save", { config })).json.config;
step(`config_save: ${saved.id}`);
const lobby = (await call("lobby_create", { name: "Проверка MCP", configId: saved.id })).json.lobby;
step(`lobby_create: ${lobby.url}`);
writeFileSync(resolve(out, "result.json"), JSON.stringify({ asset, config: saved.id, lobby, simulate: sim }, null, 2));
await client.close();
