#!/usr/bin/env node
// Uses disposable verification identities from storage/verify; never prints credentials.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "storage/verification/06-quizor");
const base = process.env.BASE ?? "http://127.0.0.1:8787";
const credentials = JSON.parse(
  await readFile(resolve(root, "storage/verify/accounts.json"), "utf8"),
);
await mkdir(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(predicate, message, timeout = 12000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(`Timeout: ${message}`);
    await pause(20);
  }
}
async function login(name) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials.accounts[name]),
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const user = (await r.json()).user;
  return {
    cookie,
    user,
    async request(method, path, body) {
      const r = await fetch(`${base}${path}`, {
        method,
        headers: {
          cookie,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = r.status === 204 ? null : await r.json();
      if (!r.ok)
        throw new Error(
          `${method} ${path}: ${r.status} ${JSON.stringify(data)}`,
        );
      return data;
    },
  };
}
const a = await login("verify-a"),
  b = await login("verify-b");
const mcp = new Client({ name: "verify-quizor", version: "1" });
await mcp.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${credentials.mcpToken}` },
    },
  }),
);
async function call(name, args) {
  const result = await mcp.callTool({ name, arguments: args });
  const text = result.content.find((c) => c.type === "text")?.text;
  assert.ok(!result.isError, `${name}: ${text}`);
  return { data: text ? JSON.parse(text) : null, content: result.content };
}
const caps = (await call("game_capabilities", { gameId: "quizor" })).data;
assert.equal(caps.presetConfigs.length, 6);
const tools = await mcp.listTools();
assert.equal(tools.tools.length, 18);

const image = (
  await call("asset_create_svg", {
    name: "Проверка медиа Quizor",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#242345"/><circle cx="320" cy="180" r="100" fill="#f9c85a"/><path d="M275 180l30 30 65-70" fill="none" stroke="#242345" stroke-width="20"/></svg>',
  })
).data.asset;
const samples = 8000 * 2;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++)
  wav.writeInt16LE(
    Math.round(Math.sin((i / 8000) * Math.PI * 2 * 440) * 5000),
    44 + i * 2,
  );
await writeFile(resolve(out, "tone.wav"), wav);
async function upload(name, bytes) {
  const ticket = (await call("asset_upload_begin", { name })).data;
  const url = new URL(ticket.uploadUrl);
  const r = await fetch(`${base}${url.pathname}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: bytes,
  });
  assert.equal(r.status, 201);
  const { asset } = await r.json();
  return asset;
}
const audio = await upload("tone.wav", wav);
const video = (
  await call("asset_import_url", {
    name: "flower.mp4",
    url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  })
).data.asset;
assert.equal(audio.mime, "audio/wav");
assert.equal(video.mime, "video/mp4");
const question = (id, prompt, answer, extra = {}) => ({
  id,
  prompt,
  fields: [{ id: "a", type: "text", answers: [{ text: answer }] }],
  ...extra,
});
const config = {
  sdk: 1,
  game: "quizor",
  gameVersion: 1,
  title: "Живая проверка Quizor",
  rules: {
    players: { min: 2, max: 2 },
    defaults: {
      timers: { preloadSeconds: 1, revealSeconds: 0.25, answerSeconds: 30 },
      appeals: true,
    },
    rounds: [
      {
        id: "sequence",
        title: "Медиа и особые вопросы",
        questions: [
          question("appeal", "На каком материке живут кенгуру?", "Австралия", {
            fields: [
              {
                id: "a",
                type: "text",
                answers: [{ text: "Австралия" }],
                wrong: [{ text: "Австрия", grade: "fail" }],
              },
            ],
            settings: { timers: { revealSeconds: 30 } },
          }),
          question("media", "Как называется этот цветок?", "Космея", {
            blocks: [
              {
                type: "group",
                durationSeconds: 1,
                blocks: [
                  { type: "image", asset: image.id },
                  { type: "audio", asset: audio.id, from: 0, to: 1 },
                  {
                    type: "video",
                    asset: video.id,
                    from: 0,
                    to: 1,
                    muted: true,
                  },
                ],
              },
            ],
          }),
          question("transfer", "Сколько сторон у треугольника?", "Три", {
            special: { type: "transfer", values: [50, 100] },
          }),
          question("auction", "Столица Франции?", "Париж", {
            special: { type: "auction", minimum: 50 },
          }),
          question("wagers", "Сколько дней в неделе?", "Семь", {
            special: { type: "wager-all" },
          }),
          question("safe", "Что светит днём?", "Солнце", {
            special: { type: "risk-free" },
          }),
          question("gift", "Подарок", "Подарок", { special: { type: "gift" } }),
        ],
      },
      {
        id: "board",
        title: "Табло",
        format: "board",
        questions: [
          question("cell", "Третья планета от Солнца?", "Земля", {
            theme: "Космос",
            value: 200,
          }),
        ],
      },
    ],
    final: {
      type: "elimination-wager",
      eligibility: "all",
      questions: [
        question("f1", "2 + 2?", "Четыре", { theme: "Счёт" }),
        question("f2", "Цвет снега?", "Белый", { theme: "Природа" }),
        question("f3", "Спутник Земли?", "Луна", { theme: "Космос" }),
      ],
    },
  },
  series: { rounds: 1 },
  timer: { turnSeconds: 0 },
  visual: { theme: "midnight" },
};
const valid = (await call("config_validate", { config })).data;
assert.equal(valid.ok, true, JSON.stringify(valid.issues));
const probe = (
  await call("config_probe", {
    config,
    questionId: "appeal",
    answers: [{ a: "АВСТРАЛИЯ!" }, { a: "Австрия" }],
  })
).data;
assert.deepEqual(
  probe.grades.map((x) => x.grade),
  ["correct", "fail"],
);
await call("config_resolve", { config, questionId: "appeal" });
const simulation = (await call("config_simulate", { config, rounds: 10 })).data;
assert.equal(simulation.finished, 10, JSON.stringify(simulation));
for (const target of [
  { kind: "question", id: "media" },
  { kind: "round", id: "board" },
  { kind: "intro", id: "sequence" },
]) {
  const preview = await call("config_preview", { config, target, seed: 7 });
  const png = preview.content.find((c) => c.type === "image");
  assert.ok(png);
  await writeFile(
    resolve(out, `preview-${target.kind}.png`),
    Buffer.from(png.data, "base64"),
  );
}
const saved = (await call("config_save", { config })).data.config;
const lobby = (
  await call("lobby_create", {
    name: "Живая проверка Quizor",
    configId: saved.id,
  })
).data.lobby;
assert.ok(!JSON.stringify(lobby).includes("Австралия"));
await b.request("POST", `/api/lobbies/${lobby.id}/join`, { role: "player" });
async function connect(person) {
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/ws`, {
    headers: { cookie: person.cookie },
  });
  const client = {
    ws,
    match: null,
    seat: null,
    seq: 0,
    errors: [],
    messages: [],
  };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    client.seq++;
    client.messages.push(m);
    if (m.type === "match") {
      client.match = m.match;
      client.seat = m.seat;
    }
    if (m.type === "error") client.errors.push(m);
  });
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  ws.send(JSON.stringify({ type: "subscribe", lobbyId: lobby.id }));
  await until(() => client.seq > 0, "subscription");
  return client;
}
const clients = [await connect(a), await connect(b)];
async function send(client, action, type = "action", expectedError) {
  const seq = client.seq,
    errors = client.errors.length;
  client.ws.send(JSON.stringify({ type, lobbyId: lobby.id, action }));
  await until(() => client.seq > seq, `action ${action.type}`);
  await pause(25);
  if (expectedError) {
    assert.ok(
      [expectedError].flat().includes(client.errors.at(-1)?.code),
      JSON.stringify(client.errors.at(-1)),
    );
    client.errors.splice(errors);
  } else
    assert.equal(
      client.errors.length,
      errors,
      JSON.stringify(client.errors.at(-1)),
    );
}
try {
  const before = await fetch(`${base}/files/assets/${video.id}`, {
    headers: { cookie: b.cookie },
  });
  assert.equal(before.status, 403);
  await a.request("POST", `/api/lobbies/${lobby.id}/start`);
  await until(
    () => clients.every((c) => c.match?.game.phase === "answer"),
    "first question",
  );
  await send(clients[0], { type: "pause" }, "control");
  await send(
    clients[1],
    { type: "answer", answers: { a: "Австрия" } },
    "action",
    ["paused", "not_your_turn"],
  );
  await send(clients[0], { type: "resume" }, "control");
  await until(() => !clients[0].match.game.paused, "resume countdown");
  assert.ok(!JSON.stringify(clients[1].match).includes("Космея"));
  await send(clients[0], { type: "answer", answers: { a: "Австралия" } });
  await send(clients[1], { type: "answer", answers: { a: "Австрия" } });
  await until(() => clients[0].match.game.phase === "reveal", "first reveal");
  await send(clients[1], {
    type: "appeal",
    questionId: "appeal",
    seat: 1,
    points: 100,
    comment: "Проверка апелляции",
  });
  await send(clients[0], { type: "appeal-vote", accept: true });
  assert.equal(clients[0].match.game.players[1].score, 100);
  await send(clients[0], {
    type: "ready",
    phase: "reveal",
    questionId: "appeal",
  });
  await send(clients[1], {
    type: "ready",
    phase: "reveal",
    questionId: "appeal",
  });
  let rangeChecked = false;
  const phases = new Set();
  const solutions = {
    media: "Космея",
    transfer: "Три",
    auction: "Париж",
    wagers: "Семь",
    safe: "Солнце",
    gift: "Подарок",
    cell: "Земля",
    f1: "Четыре",
    f2: "Белый",
    f3: "Луна",
  };
  for (
    let step = 0;
    step < 300 && clients[0].match.phase !== "finished";
    step++
  ) {
    const v = clients[0].match.game;
    phases.add(v.phase);
    if (v.questionId === "media" && !rangeChecked) {
      const r = await fetch(`${base}/files/assets/${video.id}`, {
        headers: { cookie: b.cookie, range: "bytes=0-15" },
      });
      assert.equal(r.status, 206);
      assert.equal((await r.arrayBuffer()).byteLength, 16);
      rangeChecked = true;
    }
    let acted = false;
    for (const client of clients) {
      const g = client.match.game,
        legal = g.legal;
      if (legal.includes("ready")) {
        await send(client, {
          type: "ready",
          phase: g.phase,
          questionId: g.questionId,
        });
        acted = true;
      } else if (legal.includes("select")) {
        await send(client, {
          type: "select",
          questionId: g.board.find((c) => !c.played).questionId,
        });
        acted = true;
      } else if (legal.includes("transfer")) {
        await send(client, { type: "transfer", seat: 1 });
        acted = true;
      } else if (
        legal.includes("pass") &&
        g.phase === "special" &&
        Object.keys(g.bids).length
      ) {
        await send(client, { type: "pass" });
        acted = true;
      } else if (legal.includes("bid")) {
        const amount =
          g.special.type === "transfer"
            ? g.special.values[0]
            : g.special.type === "auction"
              ? g.special.minimum
              : 5;
        await send(client, { type: "bid", amount });
        acted = true;
      } else if (legal.includes("ban")) {
        await send(client, { type: "ban", questionId: g.themes[0].questionId });
        acted = true;
      } else if (legal.includes("answer")) {
        await send(client, {
          type: "answer",
          answers: { a: solutions[g.questionId] },
        });
        acted = true;
      }
    }
    if (!acted) await pause(50);
  }
  assert.equal(
    clients[0].match.phase,
    "finished",
    JSON.stringify(clients[0].match.game),
  );
  assert.ok(rangeChecked);
  for (const message of clients[0].messages)
    if (message.type === "match" && message.match)
      phases.add(message.match.game.phase);
  assert.ok(phases.has("board"));
  assert.ok(phases.has("final-ban"));
  await writeFile(
    resolve(out, "live-result.json"),
    JSON.stringify(
      {
        lobbyId: lobby.id,
        tools: tools.tools.length,
        presets: caps.presetConfigs.length,
        simulation,
        phases: [...phases],
        result: clients[0].match,
        media: { image, audio, video },
        errors: clients.flatMap((c) => c.errors),
      },
      null,
      2,
    ),
  );
  console.log(
    `Quizor: MCP ${tools.tools.length} tools, ${simulation.finished}/10 simulations, 3 PNG previews; WS ${phases.size} phases through final, appeal/pause/media ACL green.`,
  );
} finally {
  for (const c of clients) c.ws.close();
  await mcp.close();
}

// A separate lobby remains waiting for visual/manual verification in the browser.
const browserConfig = structuredClone(config);
browserConfig.title = "Quizor · проверка сцены";
browserConfig.rules.players = { min: 1, max: 1 };
browserConfig.rules.defaults.timers = { preloadSeconds: 10, revealSeconds: 30 };
browserConfig.rules.rounds = [
  {
    id: "stage",
    title: "Всё начинается с вопроса",
    questions: [
      question("browser1", "Какая планета третья от Солнца?", "Земля"),
      question("browser-media", "Что изображено на видео?", "Цветок", {
        blocks: [
          {
            type: "image",
            asset: image.id,
            effect: "pixelate",
            durationSeconds: 6,
          },
          {
            type: "video",
            asset: video.id,
            from: 0,
            to: 5,
            muted: true,
            durationSeconds: 5,
          },
          {
            type: "audio",
            asset: audio.id,
            from: 0,
            to: 2,
            durationSeconds: 2,
          },
        ],
      }),
    ],
  },
];
browserConfig.rules.final = { type: "none" };
const prepared = await a.request("POST", "/api/lobbies", {
  name: browserConfig.title,
  config: browserConfig,
});
await writeFile(
  resolve(out, "browser-lobby.json"),
  JSON.stringify(
    {
      lobbyId: prepared.lobby.id,
      url: `http://127.0.0.1:5173/lobby/${prepared.lobby.id}`,
      config: browserConfig,
    },
    null,
    2,
  ),
);
console.log(
  `Browser verification lobby: http://127.0.0.1:5173/lobby/${prepared.lobby.id}`,
);

const formsConfig = {
  sdk: 1,
  game: "quizor",
  gameVersion: 1,
  title: "Quizor · все формы ответа",
  rules: {
    players: { min: 1, max: 1 },
    defaults: { timers: { preloadSeconds: 0, revealSeconds: 30 } },
    rounds: [
      {
        id: "forms",
        title: "Девять способов ответить",
        questions: [
          {
            id: "composite",
            prompt: "Соберите составной ответ",
            fields: [
              {
                id: "text",
                type: "text",
                label: "Писатель",
                answers: [{ text: "Толстой" }],
              },
              {
                id: "number",
                type: "number",
                label: "Год полёта",
                target: 1961,
                precision: 0,
              },
              {
                id: "choice",
                type: "choice",
                label: "Один вариант",
                options: [
                  { id: "a", text: "Верный", grade: "correct" },
                  { id: "b", text: "Другой" },
                ],
              },
              {
                id: "multi",
                type: "multi",
                label: "Несколько вариантов",
                options: [
                  { id: "a", text: "Первый", correct: true },
                  { id: "b", text: "Второй", correct: true },
                  { id: "c", text: "Лишний", correct: false },
                ],
              },
              {
                id: "order",
                type: "order",
                label: "Хронология",
                items: [
                  { id: "a", text: "Позже" },
                  { id: "b", text: "Раньше" },
                ],
                correct: ["b", "a"],
              },
              {
                id: "match",
                type: "match",
                label: "Пары",
                left: [
                  { id: "a", text: "Лево А" },
                  { id: "b", text: "Лево Б" },
                ],
                right: [
                  { id: "x", text: "Право X" },
                  { id: "y", text: "Право Y" },
                ],
                correct: { a: "y", b: "x" },
              },
              {
                id: "list",
                type: "list",
                label: "Планеты",
                items: [
                  { answers: [{ text: "Марс" }] },
                  { answers: [{ text: "Земля" }] },
                ],
                maxItems: 3,
              },
              {
                id: "point",
                type: "point",
                label: "Центр картинки",
                asset: image.id,
                target: { x: 0.5, y: 0.5 },
                steps: [
                  {
                    condition: { type: "distance", op: "lte", value: 0.1 },
                    grade: "correct",
                  },
                ],
              },
              {
                id: "oral",
                type: "oral",
                label: "Устный ответ",
                reference: "Проверочное слово",
                settings: { judge: "self" },
              },
            ],
          },
        ],
      },
    ],
  },
  series: { rounds: 1 },
  timer: { turnSeconds: 0 },
  visual: { theme: "paper" },
};
const formsLobby = await a.request("POST", "/api/lobbies", {
  name: formsConfig.title,
  config: formsConfig,
});
await writeFile(
  resolve(out, "browser-forms.json"),
  JSON.stringify(
    {
      lobbyId: formsLobby.lobby.id,
      url: `http://127.0.0.1:5173/lobby/${formsLobby.lobby.id}`,
    },
    null,
    2,
  ),
);
console.log(
  `Forms verification lobby: http://127.0.0.1:5173/lobby/${formsLobby.lobby.id}`,
);
