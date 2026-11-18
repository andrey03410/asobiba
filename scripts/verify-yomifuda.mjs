#!/usr/bin/env node
// Live Yomifuda verification. Disposable identities and evidence stay in storage/.
// Needs a local server and scripts/seed-verify.ts. --backend-only skips PNG.
// --browser creates a showcase for the last browser seat and drives disposable peers.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const root = resolve(import.meta.dirname, "..");
const base = arg("base", process.env.BASE ?? "http://127.0.0.1:8787");
const web = arg("web", "http://localhost:5173");
const out = resolve(root, arg("out", "storage/verification/09-yomifuda"));
const credentials = JSON.parse(
  await readFile(resolve(root, "storage/verify/accounts.json"), "utf8"),
);
await mkdir(out, { recursive: true });
const save = (name, data) =>
  writeFile(resolve(out, name), JSON.stringify(data, null, 2) + "\n");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(predicate, label, timeout = 12000) {
  const at = Date.now();
  while (!predicate()) {
    if (Date.now() - at > timeout) throw new Error(`Timeout: ${label}`);
    await pause(15);
  }
}
const actor = (cookie, user) => ({
  cookie,
  user,
  async request(method, path, body) {
    const r = await fetch(base + path, {
      method,
      headers: {
        cookie,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = r.status === 204 ? null : await r.json();
    assert(r.ok, `${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
    return data;
  },
  async status(path) {
    return (await fetch(base + path, { headers: { cookie } })).status;
  },
});
async function login(name) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials.accounts[name]),
  });
  assert.equal(r.status, 200, "verification login");
  return actor(
    r.headers.get("set-cookie").split(";")[0],
    (await r.json()).user,
  );
}
async function guest(lobbyId, role, name) {
  const r = await fetch(base + "/api/auth/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lobbyId,
      role,
      name,
      attempt: randomBytes(24).toString("base64url"),
    }),
  });
  assert.equal(r.status, 200, "verification guest");
  return actor(
    r.headers.get("set-cookie").split(";")[0],
    (await r.json()).user,
  );
}
async function connect(who, lobbyId, onMatch) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", {
    headers: { cookie: who.cookie },
  });
  const c = {
    ws,
    match: null,
    seat: null,
    errors: [],
    events: [],
    send(action) {
      ws.send(JSON.stringify({ type: "action", lobbyId, action }));
    },
  };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "error") c.errors.push(m);
    if (m.type === "match" && m.match) {
      c.match = m.match;
      c.seat = m.seat;
      c.events.push({
        phase: m.match.game.phase,
        round: m.match.game.round,
        stock: m.match.game.stockCount,
        table: m.match.game.table.length,
      });
      onMatch?.(c);
    }
  });
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  ws.send(JSON.stringify({ type: "subscribe", lobbyId }));
  return c;
}
const client = new Client({ name: "verify-yomifuda", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
    requestInit: {
      headers: { Authorization: `Bearer ${credentials.mcpToken}` },
    },
  }),
);
async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.find((c) => c.type === "text")?.text ?? "null";
  if (r.isError) throw new Error(`${name}: ${text}`);
  return { json: JSON.parse(text), content: r.content };
}
const a = await login("verify-a"),
  b = await login("verify-b");
const caps = (await call("game_capabilities", { gameId: "yomifuda" })).json;
assert.equal(caps.id, "yomifuda");
const template = caps.presetConfigs.find((p) => p.id === "educational").config;
const fixture = (count, handSize, identical = false) => ({
  ...structuredClone(template),
  title: `Yomifuda verification ${count}`,
  rules: {
    ...structuredClone(template.rules),
    players: 3,
    deckSize: count,
    handSize,
    revealSeconds: count === 6 ? 0.8 : 0,
    attributes: [
      { id: "power", label: "Сила" },
      { id: "focus", label: "Внимание" },
    ],
    cards: Array.from({ length: count }, (_, i) => ({
      id: `fixture-${i + 1}`,
      name: `Проверочный персонаж ${i + 1}`,
      anime: "Синтетические проверочные данные",
      values: { power: 90, focus: identical ? 10 : i + 1 },
    })),
  },
  timer: { turnSeconds: 0, onTimeout: "skip" },
});
async function prepare(config, name) {
  const checked = (await call("config_validate", { config })).json;
  assert.equal(checked.ok, true);
  assert.equal(checked.secretsHidden, true);
  assert.deepEqual(checked.config.rules.cards, []);
  const saved = (await call("config_save", { config })).json.config;
  assert.equal(saved.secretsHidden, true);
  assert.deepEqual(saved.document.rules.cards, []);
  const got = (await call("config_get", { configId: saved.id })).json.config;
  assert.deepEqual(got.document.rules.cards, []);
  const original = (
    await call("config_get", { configId: saved.id, revealSecrets: true })
  ).json.config;
  assert.equal(original.document.rules.cards.length, config.rules.cards.length);
  assert.equal(
    (await call("config_validate", { configId: saved.id })).json.ok,
    true,
  );
  const created = (await call("lobby_create", { name, configId: saved.id }))
    .json.lobby;
  const lobby = (await call("lobby_get", { lobbyId: created.id })).json.lobby;
  assert.deepEqual(lobby.config.rules.cards, []);
  return { lobby, configId: saved.id };
}
let peerC, observer;
async function runMatch(config, label, withGuards = false) {
  const { lobby, configId } = await prepare(config, label);
  await b.request("POST", `/api/lobbies/${lobby.id}/join`, { role: "player" });
  if (!peerC) peerC = await guest(lobby.id, "player", "Yomi peer");
  else
    await peerC.request("POST", `/api/lobbies/${lobby.id}/join`, {
      role: "player",
    });
  if (!observer) observer = await guest(lobby.id, "spectator", "Yomi observer");
  else
    await observer.request("POST", `/api/lobbies/${lobby.id}/join`, {
      role: "spectator",
    });
  const actors = [a, b, peerC];
  const cs = await Promise.all(actors.map((w) => connect(w, lobby.id)));
  const os = await connect(observer, lobby.id);
  const seen = new Set();
  let tieBreak = false;
  let earlyReady = false;
  let replayReconnect = false;
  try {
    await a.request("POST", `/api/lobbies/${lobby.id}/start`);
    await until(
      () => cs.every((c) => c.match?.game.phase === "choose") && os.match,
      "initial views",
    );
    for (const c of cs) {
      assert.equal(c.match.game.hand.length, config.rules.handSize);
      assert(!JSON.stringify(c.match.game).includes('"values"'));
      assert.equal(c.match.game.finalDeck, undefined);
    }
    assert.deepEqual(os.match.game.hand, []);
    let previousAttribute = null;
    while (cs[0].match.phase !== "finished") {
      const round = cs[0].match.game.round;
      await until(
        () =>
          cs.every(
            (c) =>
              c.match.game.phase === "choose" && c.match.game.round === round,
          ),
        "choose",
      );
      const before = cs.map((c) => c.match.game.hand.map((card) => card.id));
      const attribute = cs[0].match.game.attribute.id;
      if (previousAttribute !== null && config.rules.attributes.length > 1)
        assert.notEqual(attribute, previousAttribute);
      previousAttribute = attribute;
      if (withGuards && round === 1) {
        const count = cs[0].errors.length;
        cs[0].send({ type: "play", round, cardId: before[1][0] });
        await until(
          () => cs[0].errors.length > count,
          "foreign card rejection",
        );
        assert.equal(cs[0].errors.at(-1).code, "not_your_card");
        assert.deepEqual(
          cs[0].match.game.hand.map((c) => c.id),
          before[0],
        );
      }
      const plays = cs.map((c) => c.match.game.hand[0]);
      for (const card of plays) {
        assert(!seen.has(card.id), "card reused");
        seen.add(card.id);
      }
      cs[0].send({ type: "play", round, cardId: plays[0].id });
      await until(() => os.match.game.table.length === 1, "first back");
      assert.deepEqual(os.match.game.table, [
        { seat: cs[0].seat, hidden: true },
      ]);
      if (withGuards && round === 1) {
        const n = cs[0].errors.length;
        cs[0].send({ type: "play", round, cardId: plays[0].id });
        await until(() => cs[0].errors.length > n, "duplicate play rejection");
        assert.equal(cs[0].errors.at(-1).code, "not_your_turn");
        if (plays[0].image) {
          assert.equal(
            await observer.status(`/files/assets/${plays[0].image.asset}`),
            403,
          );
        }
        cs[1].ws.close();
        await until(
          () => cs[1].ws.readyState === WebSocket.CLOSED,
          "disconnect",
        );
        cs[1] = await connect(b, lobby.id);
        await until(() => cs[1].match?.game.round === round, "reconnect");
        assert.deepEqual(
          cs[1].match.game.hand.map((c) => c.id),
          before[1],
        );
        replayReconnect = true;
      }
      cs[1].send({ type: "play", round, cardId: plays[1].id });
      cs[2].send({ type: "play", round, cardId: plays[2].id });
      await until(
        () =>
          cs.every((c) => ["reveal", "review"].includes(c.match.game.phase)) &&
          os.match.game.table.length === 3,
        "public reveal",
      );
      const table = os.match.game.table;
      assert(table.every((t) => !t.hidden && Number.isInteger(t.value)));
      if (label === "partial-parity") {
        assert.equal(table.filter((t) => t.winner).length, 2);
        assert(table.filter((t) => t.winner).every((t) => t.points === 0.5));
      } else if (config.rules.cards.every((c) => c.values.focus === 10)) {
        assert(table.every((t) => t.winner && t.points === 0.5));
      } else if (attribute === "power") {
        tieBreak = true;
        assert.equal(table.filter((t) => t.winner).length, 1);
        assert.equal(
          table.find((t) => t.winner).tieTotal,
          Math.max(...table.map((t) => t.tieTotal)),
        );
        assert.equal(table.find((t) => t.winner).points, 1);
      }
      if (withGuards && round === 1) {
        assert.equal(cs[0].match.game.phase, "reveal");
        const n = cs[0].errors.length;
        cs[0].send({ type: "ready", round });
        await until(() => cs[0].errors.length > n, "early ready rejection");
        assert.equal(cs[0].errors.at(-1).code, "not_your_turn");
        earlyReady = true;
        if (plays[0].image)
          assert.equal(
            await observer.status(`/files/assets/${plays[0].image.asset}`),
            200,
          );
      }
      await until(
        () => cs.every((c) => c.match.game.phase === "review"),
        "review",
      );
      for (const c of cs) c.send({ type: "ready", round });
      await until(
        () =>
          cs[0].match.phase === "finished" || cs[0].match.game.round > round,
        "next round",
      );
      if (withGuards && cs[0].match.phase !== "finished" && round === 1) {
        const n = cs[0].errors.length;
        cs[0].send({ type: "play", round, cardId: plays[0].id });
        await until(() => cs[0].errors.length > n, "stale round rejection");
        assert.equal(cs[0].errors.at(-1).code, "stale_round");
      }
    }
    assert.equal(seen.size, config.rules.cards.length);
    assert.equal(cs[0].match.game.stockCount, 0);
    assert.equal(cs[0].match.game.finalDeck.length, config.rules.cards.length);
    assert(cs[0].match.game.players.every((p) => p.handCount === 0));
    const gameWinners = cs[0].match.game.result.winners;
    assert.deepEqual(cs[0].match.result.winners, gameWinners);
    const publicMatch = (await call("lobby_get", { lobbyId: lobby.id })).json
      .match;
    assert.equal(publicMatch.phase, "finished");
    assert.deepEqual(publicMatch.result.winners, gameWinners);
    const result = {
      lobbyId: lobby.id,
      configId,
      cards: seen.size,
      rounds: cs[0].match.game.round,
      score: cs[0].match.game.players.map((p) => p.score),
      winners: gameWinners,
      matchResult: publicMatch.result,
      tieBreak,
      earlyReady,
      replayReconnect,
      events: os.events,
    };
    await save(`${label}.json`, result);
    console.log(`PASS ${label}: ${seen.size} cards / ${result.rounds} rounds`);
    return result;
  } finally {
    for (const c of [...cs, os]) c.ws.close();
  }
}

try {
  if (process.argv.includes("--browser")) {
    const config = JSON.parse(
      await readFile(resolve(out, "showcase-config.json"), "utf8"),
    );
    const players = Number(arg("players", config.rules.players));
    assert(Number.isInteger(players) && players >= 2 && players <= 6);
    assert.equal(config.rules.cards.length % players, 0);
    config.rules.players = players;
    config.rules.handSize = Number(
      arg(
        "hand",
        Math.min(config.rules.handSize, config.rules.cards.length / players),
      ),
    );
    if (process.argv.includes("--reduced-motion"))
      config.visual.reducedMotion = true;
    assert(
      Number.isInteger(config.rules.handSize) &&
        config.rules.handSize >= 1 &&
        config.rules.handSize <= config.rules.cards.length / players,
    );
    const prepared = process.argv.includes("--resume-browser")
      ? JSON.parse(await readFile(resolve(out, "browser-lobby.json"), "utf8"))
      : null;
    const { lobby, configId } = prepared
      ? {
          lobby: (await a.request("GET", `/api/lobbies/${prepared.lobbyId}`))
            .lobby,
          configId: prepared.configId,
        }
      : await prepare(config, "Ёмифуда · мобильная проверка");
    if (lobby.seats > 2)
      await b.request("POST", `/api/lobbies/${lobby.id}/join`, {
        role: "player",
      });
    const publicData = {
      lobbyId: lobby.id,
      configId,
      url: `${web}/lobby/${lobby.id}`,
      cards: config.rules.cards.length,
      players: lobby.seats,
    };
    await save("browser-lobby.json", publicData);
    console.log(`BROWSER ${publicData.url}`);
    const sent = new Set();
    const auto = (c) => {
      const g = c.match.game;
      if (c.match.phase === "finished") return;
      let action;
      if (g.phase === "choose" && g.canPlay)
        action = { type: "play", round: g.round, cardId: g.hand[0].id };
      if (g.phase === "review" && g.canReady)
        action = { type: "ready", round: g.round };
      if (!action) return;
      const key = `${c.seat}:${g.round}:${action.type}`;
      if (sent.has(key)) return;
      sent.add(key);
      c.send(action);
    };
    const peers = lobby.seats > 2 ? [a, b] : [a];
    if (prepared && peers.length < lobby.seats - 1) {
      const savedPeers = JSON.parse(
        await readFile(resolve(out, "browser-peer-sessions.json"), "utf8"),
      );
      const ids = new Set(
        lobby.members.filter((m) => m.role === "player").map((m) => m.userId),
      );
      for (const peer of savedPeers)
        if (ids.has(peer.user.id)) peers.push(actor(peer.cookie, peer.user));
      assert.equal(
        peers.length,
        lobby.seats - 1,
        "Resume needs the original disposable guest peers",
      );
    } else {
      for (let i = peers.length; i < lobby.seats - 1; i++)
        peers.push(await guest(lobby.id, "player", `Yomi peer ${i + 1}`));
      // Test-only session secrets, like seed-verify credentials, never leave ignored storage.
      await save(
        "browser-peer-sessions.json",
        peers
          .filter((p) => p.user.role === "guest")
          .map((p) => ({ cookie: p.cookie, user: p.user })),
      );
    }
    const connections = await Promise.all(
      peers.map((peer) => connect(peer, lobby.id, auto)),
    );
    const ca = connections[0];
    try {
      const started = Date.now();
      while (true) {
        const current = (await a.request("GET", `/api/lobbies/${lobby.id}`))
          .lobby;
        if (
          current.members.filter((m) => m.role === "player").length ===
          lobby.seats
        )
          break;
        if (Date.now() - started > 540000)
          throw new Error("browser third-seat timeout");
        await pause(500);
      }
      const current = (await a.request("GET", `/api/lobbies/${lobby.id}`))
        .lobby;
      if (current.status !== "playing")
        await a.request("POST", `/api/lobbies/${lobby.id}/start`);
      await until(
        () => ca.match?.phase === "finished",
        "browser match finish",
        540000,
      );
      await save("browser-peer-result.json", {
        lobbyId: lobby.id,
        events: ca.events,
        errors: connections.flatMap((c) => c.errors),
        phase: ca.match.phase,
      });
      console.log("PASS browser match reached finish");
    } finally {
      connections.forEach((c) => c.ws.close());
    }
  } else {
    const repeatedDeck = fixture(3, 1);
    repeatedDeck.series.rounds = 2;
    assert.equal(
      (await call("config_validate", { config: repeatedDeck })).json.ok,
      false,
    );
    const invalid = (await call("config_save", { config: repeatedDeck })).json.config;
    assert.equal(invalid.validationStatus, "invalid", "Saved repeated deck must be marked invalid");
    assert.equal(invalid.document.rules, null, "Invalid stored rules must remain private");
    for (const source of [{ config: repeatedDeck }, { configId: invalid.id }]) {
      const result = await client.callTool({
        name: "lobby_create",
        arguments: source,
      });
      assert.equal(
        result.isError,
        true,
        "Lobby creation must reject repeated revealed decks",
      );
    }
    const fractional = fixture(6, 2);
    fractional.rules.cards[0].values.power = 1.5;
    assert.equal(
      (await call("config_validate", { config: fractional })).json.ok,
      false,
    );
    assert.equal(
      (await call("config_validate", { config: fixture(61, 5) })).json.ok,
      false,
    );
    const sumConfig = fixture(6, 2);
    try {
      const portraits = JSON.parse(
        await readFile(resolve(out, "imported-portraits.json"), "utf8"),
      );
      sumConfig.rules.cards.forEach((c, i) => {
        c.image = { asset: portraits[i].asset.id };
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const sum = await runMatch(sumConfig, "sum-tiebreak", true);
    assert(sum.tieBreak && sum.earlyReady && sum.replayReconnect);
    const tie = await runMatch(fixture(3, 1, true), "full-parity");
    assert(tie.score.every((s) => s === 0.5));
    const partialConfig = fixture(3, 1);
    partialConfig.rules.attributes = [{ id: "power", label: "Сила" }];
    partialConfig.rules.cards.forEach((card, i) => {
      card.values = { power: i < 2 ? 90 : 40 };
    });
    const partial = await runMatch(partialConfig, "partial-parity");
    assert.equal(partial.winners.length, 2);
    const full = await runMatch(fixture(60, 5), "full-deck-60");
    assert.equal(full.rounds, 20);
    const sim = (
      await call("config_simulate", { configId: full.configId, rounds: 5 })
    ).json;
    assert.equal(sim.finished, 5);
    assert.equal(sim.rounds, 5);
    if (!process.argv.includes("--backend-only"))
      for (const moment of ["start", "end"]) {
        const result = await call("config_preview", {
          configId: sum.configId,
          moment,
          seed: 2,
        });
        const image = result.content.find((c) => c.type === "image");
        assert(image && image.mimeType === "image/png");
        await writeFile(
          resolve(out, `preview-${moment}.png`),
          Buffer.from(image.data, "base64"),
        );
      }
    await save("live-result.json", {
      checkedAt: new Date().toISOString(),
      game: caps.id,
      results: [sum, tie, partial, full],
      simulate: sim,
      preview: !process.argv.includes("--backend-only"),
    });
    console.log(
      "PASS real MCP / WS / ownership / reconnect / hidden cards / integer values / scoring / 60-card finish",
    );
  }
} finally {
  await client.close();
}
