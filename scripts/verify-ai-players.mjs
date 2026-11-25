// Run with node against the local verification server and accounts.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = resolve(import.meta.dirname, "..");
const base = process.env.BASE ?? "http://127.0.0.1:8787";
const output = resolve(root, "storage/verification/14-ai-players");
const { accounts } = JSON.parse(await readFile(resolve(root, "storage/verify/accounts.json"), "utf8"));
await mkdir(output, { recursive: true });
const login = await fetch(base + "/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(accounts["verify-a"]),
});
assert.equal(login.status, 200, "verification host login");
const cookie = login.headers.get("set-cookie").split(";")[0];
async function host(method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await res.json();
  assert.ok(res.ok, `${path}: ${res.status} ${value.error?.message ?? ""}`);
  return value;
}
async function client(number) {
  const c = new Client({ name: `acceptance-seat-${number}`, version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp")));
  return c;
}
async function call(c, name, args = {}) {
  const res = await c.callTool({ name, arguments: args });
  const txt = res.content.find(block => block.type === "text")?.text;
  const value = JSON.parse(txt);
  if (res.isError) {
    const error = new Error(`${name}: ${value.error?.message ?? txt}`);
    error.code = value.error?.code;
    throw error;
  }
  return value;
}

const scenarios = [
  ["tic-tac-toe", "classic", 2],
  ["jinchi", "duel", 2],
  ["russkoe-pole", "solo", 1],
  ["quizor", "classic", 2],
  ["yomifuda", "educational", 2],
];

function fixture(game, config) {
  const rules = config.rules;
  config.series.rounds = 1;
  if (game === "jinchi") rules.end.maxRounds = 2;
  if (game === "russkoe-pole") {
    rules.words = { source: "custom", themes: ["priroda"], rounds: 1, custom: [{ question: "Кто мурлычет?", answer: "КОТ" }] };
    rules.wheel = [100, 200, 300, 400].map(value => ({ type: "points", value }));
    rules.super.enabled = false;
  }
  if (game === "quizor") {
    rules.players = { min: 2, max: 2 };
    rules.rounds = [{ id: "warmup", questions: [{
      id: "sum", prompt: "Сколько будет два плюс два?",
      fields: [{ id: "sum", type: "text", answers: [{ text: "4" }] }],
    }] }];
    rules.defaults = { ...rules.defaults, timers: { ...rules.defaults?.timers, revealSeconds: 0.05, answerSeconds: 35 } };
  }
  if (game === "yomifuda") {
    Object.assign(rules, { players: 2, handSize: 2, revealSeconds: 0.1 });
  }
  return config;
}

// These decisions consume only the acting player's MCP event.
function decide(game, event) {
  const view = event.state.game;
  const has = type => event.actions.some(a => a.type === type);
  if (game === "tic-tac-toe") {
    const i = view.cells.indexOf(-1);
    return { type: "place", row: Math.floor(i / view.width), col: i % view.width };
  }
  if (game === "jinchi") {
    if (has("roll")) return { type: "roll" };
    if (has("skip-impossible")) return { type: "skip-impossible" };
    if (has("place")) {
      const placement = event.actions.find(a => a.type === "place" && Number.isInteger(a.fields?.x));
      if (placement) return { type: "place", ...placement.fields };
    }
    if (has("reroll")) return { type: "reroll" };
  }
  if (game === "russkoe-pole") {
    if (has("spin")) return { type: "spin" };
    if (has("solve") && view.question.includes("мурлычет")) return { type: "solve", text: "кот" };
  }
  if (game === "quizor") {
    if (has("answer") && view.prompt.includes("два плюс два")) {
      return { type: "answer", questionId: view.questionId, answers: { [view.fields[0].id]: "4" } };
    }
    if (has("ready")) return { type: "ready", phase: view.phase, ...(view.questionId ? { questionId: view.questionId } : {}) };
  }
  if (game === "yomifuda") {
    if (has("play")) return { type: "play", round: view.round, cardId: view.hand[0].id };
    if (has("ready")) return { type: "ready", round: view.round };
  }
  throw new Error(`Unhandled turn in ${game}, phase=${view.phase}, forms=${event.actions.map(a => a.type)}`);
}

async function play([game, presetId, count]) {
  const details = (await host("GET", `/api/games/${game}`)).game;
  const preset = details.presetConfigs.find(p => p.id === presetId);
  const config = fixture(game, structuredClone(preset.config));
  const { lobby } = await host("POST", "/api/lobbies", { name: `Проверка ИИ · ${game}`, config });
  await host("POST", `/api/lobbies/${lobby.id}/join`, { role: "spectator" });
  const players = [];
  const clients = [];
  try {
    for (let i = 0; i < count; i++) {
      const c = await client(i);
      clients.push(c);
      const toolNames = (await c.listTools()).tools.map(t => t.name);
      assert.ok(!toolNames.includes("config_get"));
      const attempt = (await call(c, "agent_prepare_join")).attempt;
      const result = await call(c, "agent_join_by_link", { url: lobby.url, name: "Рин", difficulty: i ? "high" : "medium", attempt });
      const same = await call(c, "agent_join_by_link", { url: lobby.url, name: "Рин", attempt, difficulty: i ? "high" : "medium" });
      assert.equal(result.key, same.key);
      players.push({ c, login: result.member.login, conn: { lobbyId: lobby.id, key: result.key }, after: 0, moves: 0 });
    }
    assert.equal(new Set(players.map(p => p.login)).size, count);
    await host("POST", `/api/lobbies/${lobby.id}/start`);
    const deadline = Date.now() + 90000;
    while (players.some(p => !p.finished) && Date.now() < deadline) {
      for (const player of players.filter(p => !p.finished)) {
        const { event, instructions } = await call(player.c, "agent_wait", { ...player.conn, after: player.after, timeoutMs: 100 });
        assert.ok(instructions);
        if (!event) continue;
        player.after = event.cursor;
        if (event.kind === "finished") {
          assert.ok(event.state.result);
          player.finished = true;
        } else if (event.kind === "turn") {
          const action = decide(game, event);
          try {
            await call(player.c, "agent_act", { ...player.conn, cursor: event.cursor, action });
          } catch (error) {
            // A running timer can change the phase between agent_wait and agent_act.
            if (error.code === "stale_agent_event") continue;
            throw error;
          }
          player.moves++;
        }
      }
      if (!players.every(p => p.finished)) await delay(20);
    }
    assert.ok(players.every(p => p.finished && p.moves > 0), `${game} did not finish with every seat playing`);
    const result = { game, lobbyId: lobby.id, players: players.map(p => ({ name: p.login, moves: p.moves })), finished: true };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await Promise.all(clients.map(c => c.close()));
  }
}

const selected = scenarios.filter(([game]) => !process.argv[2] || process.argv[2] === game);
assert.ok(selected.length, "unknown game");
const results = [];
for (const game of selected) results.push(await play(game));
await writeFile(resolve(output, `matches${process.argv[2] ? "-" + process.argv[2] : ""}.json`), JSON.stringify(results, null, 2));
