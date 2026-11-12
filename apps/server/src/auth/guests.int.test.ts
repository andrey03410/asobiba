import { ticTacToe } from "@asobiba/game-tic-tac-toe";
import { presetDocument } from "@asobiba/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { randomString } from "../ids";
import { createTestApp, resetDb, signUp, type TestApp, type TestUser } from "../test/helpers";

let t: TestApp;
let host: TestUser;
let lobbyId: string;
const sockets: WebSocket[] = [];
const classic = () => presetDocument(ticTacToe, ticTacToe.presets.find((p) => p.id === "classic"));

function cookie(res: { headers: Record<string, unknown> }) {
  const value = res.headers["set-cookie"];
  return String(Array.isArray(value) ? value[0] : value ?? "").split(";")[0]!;
}
function call(method: "GET" | "POST", url: string, session = "", payload?: unknown) {
  return t.app.inject({ method, url, headers: { cookie: session }, payload: payload as never });
}
function guest(name = "Саша", role = "player", attempt = randomString(40), session = "") {
  return call("POST", "/api/auth/guest", session, { name, role, lobbyId, attempt });
}
function next(ws: WebSocket, pred: (message: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off("message", receive); reject(new Error("WebSocket message timeout")); }, 5000);
    function receive(raw: WebSocket.RawData) {
      const message = JSON.parse(raw.toString());
      if (pred(message)) { clearTimeout(timer); ws.off("message", receive); resolve(message); }
    }
    ws.on("message", receive);
  });
}
async function connect(session: string) {
  const ws = new WebSocket(`${t.url.replace("http", "ws")}/ws`, { headers: { cookie: session } });
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  return ws;
}

beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  host = await signUp(t, "host");
  const res = await call("POST", "/api/lobbies", host.cookie, { name: "Вечер", config: classic() });
  lobbyId = res.json().lobby.id;
});
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await t?.close();
});

describe("guest invitations", () => {
  it("shows only invitation metadata before identification", async () => {
    const res = await call("GET", `/api/lobbies/${lobbyId}/invitation`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ invitation: { id: lobbyId, name: "Вечер", gameTitle: "Крестики-нолики", host: "host", status: "waiting", players: 1, seats: 2 } });
    expect((await call("GET", `/api/lobbies/${lobbyId}`)).statusCode).toBe(401);
  });

  it("joins once with a trimmed name, reuses retries and the current account", async () => {
    const attempt = randomString(40);
    const res = await guest("  Саша  ", "player", attempt);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ login: "Саша", role: "guest" });
    expect(String(res.headers["set-cookie"])).toContain("HttpOnly");
    const session = cookie(res);
    expect((await call("GET", "/api/me", session)).json().user).toEqual(res.json().user);
    const retry = await guest("Саша", "player", attempt);
    expect(retry.json().user.id).toBe(res.json().user.id);
    expect(cookie(retry)).toBe(session);
    expect(retry.json().lobby.members).toHaveLength(2);
    expect(retry.json().lobby.members[1].login).toBe("Саша · гость 1");
    const existing = await guest("Другое имя", "player", randomString(40), host.cookie);
    expect(existing.json().user).toEqual(host.user);
    expect(existing.headers["set-cookie"]).toBeUndefined();
    expect(await t.db.user.count()).toBe(2);
  });

  it("validates names and never creates a guest for a missing or closed lobby", async () => {
    for (const name of [" ", "x".repeat(25), "Саша\nПаша", "<script>"]) {
      expect((await guest(name)).statusCode).toBe(400);
    }
    const missing = await call("POST", "/api/auth/guest", "", { name: "Друг", role: "player", lobbyId: "missing", attempt: randomString(40) });
    expect(missing.statusCode).toBe(404);
    await call("POST", `/api/lobbies/${lobbyId}/close`, host.cookie);
    expect((await guest()).json().error.code).toBe("closed");
    expect(await t.db.user.count()).toBe(1);
  });

  it("keeps a guest session after a full-lobby race without silently joining as a spectator", async () => {
    await guest("Первый");
    const res = await guest("Второй");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("lobby_full");
    const session = cookie(res);
    expect((await call("GET", "/api/me", session)).json().user.login).toBe("Второй");
    const lobby = (await call("GET", `/api/lobbies/${lobbyId}`, host.cookie)).json().lobby;
    expect(lobby.members).toHaveLength(2);
    const watch = await call("POST", `/api/lobbies/${lobbyId}/join`, session, { role: "spectator" });
    expect(watch.json().lobby.members[2]).toMatchObject({ role: "spectator", login: "Второй · гость 2" });
  });

  it("does not grant account powers or allow an implicit identity replacement", async () => {
    const res = await guest();
    expect(res.statusCode).toBe(200);
    const session = cookie(res);
    for (const path of ["/api/lobbies", "/api/games", "/api/configs", "/api/assets", "/api/tokens", "/api/invites"]) {
      expect((await call("GET", path, session)).statusCode, path).toBe(403);
    }
    for (const [path, payload] of [["/api/lobbies", { config: classic() }], ["/api/tokens", { name: "agent" }], ["/api/configs/validate", { config: classic() }], [`/api/lobbies/${lobbyId}/start`, {}], [`/api/lobbies/${lobbyId}/close`, {}]] as const) {
      expect((await call("POST", path, session, payload)).statusCode, path).toBe(403);
    }
    expect((await call("POST", "/api/auth/login", session, { login: "host", password: host.password })).statusCode).toBe(409);
    expect((await call("GET", "/api/me", session)).json().user.id).toBe(res.json().user.id);
  });

  it("distinguishes equal names and scopes image access to visited lobbies", async () => {
    const image = await t.services.assets.createFromSvg(host.user.id, "figure", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>');
    const hidden = await t.services.assets.createFromSvg(host.user.id, "private", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle r="3"/></svg>');
    const config = { ...classic(), visual: { theme: "classic", pieces: [{ asset: image.id }] } };
    const other = (await call("POST", "/api/lobbies", host.cookie, { config })).json().lobby;
    const a = await guest("Саша");
    const b = await guest("Саша", "spectator");
    expect(a.json().user.id).not.toBe(b.json().user.id);
    expect(b.json().lobby.members.map((m: any) => m.login)).toEqual(["host", "Саша · гость 1", "Саша · гость 2"]);
    const session = cookie(a);
    expect((await call("GET", `/files/assets/${image.id}`, session)).statusCode).toBe(403);
    await call("GET", `/api/lobbies/${other.id}`, session);
    expect((await call("GET", `/files/assets/${image.id}`, session)).statusCode).toBe(200);
    expect((await call("GET", `/files/assets/${hidden.id}`, session)).statusCode).toBe(403);
  });

  it("releases waiting places, revokes retries and permits a subsequent account login", async () => {
    const attempt = randomString(40);
    const res = await guest("Друг", "player", attempt);
    const session = cookie(res);
    expect((await call("POST", "/api/auth/logout", session)).statusCode).toBe(204);
    expect((await call("GET", "/api/me", session)).json().user).toBeNull();
    expect((await call("GET", `/api/lobbies/${lobbyId}`, host.cookie)).json().lobby.members).toHaveLength(1);
    expect((await guest("Друг", "player", attempt)).statusCode).toBe(409);
    const logged = await call("POST", "/api/auth/login", "", { login: "host", password: host.password });
    expect(logged.json().user).toEqual(host.user);
  });

  it("limits new guest identities even when attempts succeed", async () => {
    for (let i = 0; i < 30; i++) expect((await guest("Друг", "spectator")).statusCode).toBe(200);
    expect((await guest("Ещё", "spectator")).statusCode).toBe(429);
  });
});

describe("guest live sessions", () => {
  it("restores a guest seat, finishes a real match and preserves historical names", async () => {
    const g = await guest();
    expect(g.statusCode).toBe(200);
    const session = cookie(g);
    await t.listen();
    const a = await connect(host.cookie);
    const b = await connect(session);
    const first = next(b, (m) => m.type === "lobby");
    b.send(JSON.stringify({ type: "subscribe", lobbyId }));
    await first;
    const started = next(b, (m) => m.type === "match" && m.match);
    await call("POST", `/api/lobbies/${lobbyId}/start`, host.cookie);
    expect((await started).seat).toBe(1);
    b.close();
    const reconnected = await connect(session);
    const restored = next(reconnected, (m) => m.type === "match" && m.match);
    reconnected.send(JSON.stringify({ type: "subscribe", lobbyId }));
    expect((await restored).seat).toBe(1);
    for (const [ws, row, col] of [[a, 0, 0], [reconnected, 1, 0], [a, 0, 1], [reconnected, 1, 1], [a, 0, 2]] as const) {
      const update = next(reconnected, (m) => m.type === "match" && m.match);
      ws.send(JSON.stringify({ type: "action", lobbyId, action: { type: "place", row, col } }));
      await update;
    }
    await call("POST", "/api/auth/logout", session);
    const finished = (await call("GET", `/api/lobbies/${lobbyId}`, host.cookie)).json().lobby;
    expect(finished.status).toBe("finished");
    expect(finished.seatNames).toEqual(["host", "Саша · гость 1"]);
    expect(finished.members).toHaveLength(1);
  });

  it("requires active-match confirmation and immediately closes old sockets", async () => {
    const res = await guest();
    expect(res.statusCode).toBe(200);
    const session = cookie(res);
    await t.listen();
    const ws = await connect(session);
    const subscribed = next(ws, (m) => m.type === "lobby");
    ws.send(JSON.stringify({ type: "subscribe", lobbyId }));
    await subscribed;
    await call("POST", `/api/lobbies/${lobbyId}/start`, host.cookie);
    expect((await call("POST", "/api/auth/logout", session)).json().error.code).toBe("active_guest_matches");
    expect((await call("GET", "/api/me", session)).json().user).not.toBeNull();
    const closed = new Promise<number>((resolve) => ws.once("close", resolve));
    expect((await call("POST", "/api/auth/logout", session, { confirmActive: true })).statusCode).toBe(204);
    expect(await closed).toBe(4401);
    expect((await call("GET", `/api/lobbies/${lobbyId}`, host.cookie)).json().lobby.members).toHaveLength(2);
  });

  it("closes a socket when its session expires and does not reclaim by name", async () => {
    const res = await guest();
    expect(res.statusCode).toBe(200);
    await t.db.session.updateMany({ where: { userId: res.json().user.id }, data: { expiresAt: new Date(Date.now() + 250) } });
    await t.listen();
    const ws = await connect(cookie(res));
    expect(await new Promise<number>((resolve) => ws.once("close", resolve))).toBe(4401);
    expect((await call("GET", "/api/me", cookie(res))).json().user).toBeNull();
    const replacement = await guest("Саша", "spectator");
    expect(replacement.json().user.id).not.toBe(res.json().user.id);
  });
});
