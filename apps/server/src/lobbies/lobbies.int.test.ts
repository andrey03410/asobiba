import type { LobbyDto, ServerMessage } from "@asobiba/api";
import { presetDocument } from "@asobiba/sdk";
import { ticTacToe } from "@asobiba/game-tic-tac-toe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createTestApp, resetDb, signUp, type TestApp, type TestUser } from "../test/helpers";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
});
afterEach(async () => {
  await t?.close();
});

const classic = () => presetDocument(ticTacToe, ticTacToe.presets.find((p) => p.id === "classic"));

async function api(user: TestUser, method: "GET" | "POST", url: string, payload?: unknown) {
  const res = await t.app.inject({ method, url, headers: { cookie: user.cookie }, payload: payload as never });
  return { status: res.statusCode, body: res.json() };
}

class Client {
  messages: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => (w.pred(msg) ? (w.resolve(msg), false) : true));
    });
  }
  static async open(base: string, cookie: string): Promise<Client> {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { cookie } });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return new Client(ws);
  }
  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }
  next(pred: (m: ServerMessage) => boolean, timeoutMs = 5000, label = ""): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for message ${label}; got: ${this.messages.map((m) => (m.type === "match" ? `match:${m.match?.phase ?? "none"}` : m.type === "error" ? `error:${m.code}` : m.type)).join(",")}`)),
        timeoutMs,
      );
      this.waiters.push({ pred, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  }
  close() {
    this.ws.close();
  }
}

const isMatch = (pred: (m: Extract<ServerMessage, { type: "match" }>) => boolean = () => true) => (m: ServerMessage) => m.type === "match" && m.match !== null && pred(m);

describe("lobbies over HTTP", () => {
  it("creates a lobby with a frozen config, joins and starts", async () => {
    const ann = await signUp(t, "ann");
    const bob = await signUp(t, "bob");
    const created = await api(ann, "POST", "/api/lobbies", { name: "Вечер", config: classic() });
    expect(created.status).toBe(201);
    const lobby = created.body.lobby as LobbyDto;
    expect(lobby).toMatchObject({ name: "Вечер", status: "waiting", seats: 2, minPlayers: 2, host: { login: "ann" } });
    expect(lobby.url).toBe(`http://asobiba.test/lobby/${lobby.id}`);
    expect(lobby.members).toEqual([expect.objectContaining({ login: "ann", role: "player", seat: null })]);

    expect((await api(ann, "POST", `/api/lobbies/${lobby.id}/start`)).body.error.code).toBe("not_enough_players");
    expect((await api(bob, "POST", `/api/lobbies/${lobby.id}/join`, { role: "player" })).status).toBe(200);
    expect((await api(bob, "POST", `/api/lobbies/${lobby.id}/start`)).status).toBe(403);
    const started = await api(ann, "POST", `/api/lobbies/${lobby.id}/start`);
    expect(started.body).toMatchObject({ lobby: { status: "playing" } });
    expect(started.body.lobby.members.map((m: { seat: number }) => m.seat)).toEqual([0, 1]);

    const carol = await signUp(t, "carol");
    expect((await api(carol, "POST", `/api/lobbies/${lobby.id}/join`, { role: "player" })).body.error.code).toBe("match_in_progress");
    expect((await api(carol, "POST", `/api/lobbies/${lobby.id}/join`, { role: "spectator" })).status).toBe(200);
    expect((await api(bob, "POST", `/api/lobbies/${lobby.id}/leave`)).body.error.code).toBe("match_in_progress");

    const list = await api(carol, "GET", "/api/lobbies");
    expect(list.body.lobbies[0]).toMatchObject({ id: lobby.id, players: 2, seats: 2, status: "playing", configTitle: "Классические крестики-нолики" });
  });

  it("rejects a config with someone else's image", async () => {
    const ann = await signUp(t, "ann");
    const bob = await signUp(t, "bob");
    const asset = await t.services.assets.createFromSvg(bob.user.id, "кот", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>');
    const config = { ...classic(), visual: { theme: "classic", pieces: [{ asset: asset.id }] } };
    const res = await api(ann, "POST", "/api/lobbies", { name: "x", config });
    expect(res.status).toBe(422);
    expect(res.body.issues[0]).toMatchObject({ path: "visual.pieces[0].asset", code: "asset_not_found" });
    expect((await api(bob, "POST", "/api/lobbies", { name: "x", config })).status).toBe(201);
  });
});

describe("a live match over WebSocket", () => {
  it("plays to a win: turns, errors, per-seat views and spectators", async () => {
    const base = await t.listen();
    const ann = await signUp(t, "ann");
    const bob = await signUp(t, "bob");
    const eve = await signUp(t, "eve");
    const { body } = await api(ann, "POST", "/api/lobbies", { name: "Партия", config: classic() });
    const id = body.lobby.id as string;
    await api(bob, "POST", `/api/lobbies/${id}/join`, { role: "player" });
    await api(eve, "POST", `/api/lobbies/${id}/join`, { role: "spectator" });

    const a = await Client.open(base, ann.cookie);
    const b = await Client.open(base, bob.cookie);
    const e = await Client.open(base, eve.cookie);
    for (const c of [a, b, e]) c.send({ type: "subscribe", lobbyId: id });
    await Promise.all([a, b, e].map((c) => c.next((m) => m.type === "lobby")));

    const firstA = a.next(isMatch(), 5000, "first");
    await api(ann, "POST", `/api/lobbies/${id}/start`);
    const startView = (await firstA) as Extract<ServerMessage, { type: "match" }>;
    expect(startView.seat).toBe(0);
    expect((startView.match?.game as { legal: number[] }).legal).toHaveLength(9);

    const bobError = b.next((m) => m.type === "error", 5000, "bobError");
    b.send({ type: "action", lobbyId: id, action: { type: "place", row: 0, col: 0 } });
    expect(await bobError).toMatchObject({ code: "not_your_turn" });

    const moves: Array<[TestUser, Client, number, number]> = [
      [ann, a, 0, 0],
      [bob, b, 1, 0],
      [ann, a, 0, 1],
      [bob, b, 1, 1],
      [ann, a, 0, 2],
    ];
    const finalP = a.next(isMatch((m) => m.match?.phase === "finished"), 8000, "final");
    for (const [, client, row, col] of moves) {
      const seen = e.next(isMatch((m) => (m.match?.game as { cells: number[] }).cells[row * 3 + col] !== -1), 5000, `move ${row},${col}`);
      client.send({ type: "action", lobbyId: id, action: { type: "place", row, col } });
      const spectatorView = (await seen) as Extract<ServerMessage, { type: "match" }>;
      expect(spectatorView.seat).toBeNull();
      expect((spectatorView.match?.game as { legal: number[] }).legal).toEqual([]);
    }
    const final = (await finalP) as Extract<ServerMessage, { type: "match" }>;
    expect(final.match?.result).toEqual({ winners: [0], draw: false, scores: [1, 0] });
    expect((await t.services.lobbies.get(id)).status).toBe("finished");
    const row = await t.db.match.findFirst({ where: { lobbyId: id } });
    expect(row?.status).toBe("finished");
    expect((row?.log as unknown[]).length).toBe(5);

    // a rematch swaps seats
    const again = await api(ann, "POST", `/api/lobbies/${id}/start`);
    expect(again.body.lobby.members.find((m: { login: string }) => m.login === "bob").seat).toBe(0);
    for (const c of [a, b, e]) c.close();
  });

  it("closes the socket without a session", async () => {
    const base = await t.listen();
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
    const code = await new Promise<number>((resolve) => ws.on("close", (c) => resolve(c)));
    expect(code).toBe(4401);
  });

  it("applies the turn timer on the server", async () => {
    const base = await t.listen();
    const ann = await signUp(t, "ann");
    const bob = await signUp(t, "bob");
    const config = { ...classic(), timer: { turnSeconds: 3, onTimeout: "lose" } };
    const { body } = await api(ann, "POST", "/api/lobbies", { name: "Таймер", config });
    const id = body.lobby.id;
    await api(bob, "POST", `/api/lobbies/${id}/join`, { role: "player" });
    const b = await Client.open(base, bob.cookie);
    b.send({ type: "subscribe", lobbyId: id });
    await b.next((m) => m.type === "lobby");
    await api(ann, "POST", `/api/lobbies/${id}/start`);
    const end = (await b.next(isMatch((m) => m.match?.phase === "finished"), 8000)) as Extract<ServerMessage, { type: "match" }>;
    expect(end.match?.lastRound?.reason).toBe("timeout");
    expect(end.match?.result?.winners).toEqual([1]);
    b.close();
  });

  it("restores a turn-based match after a restart", async () => {
    const ann = await signUp(t, "ann");
    const bob = await signUp(t, "bob");
    const { body } = await api(ann, "POST", "/api/lobbies", { name: "Рестарт", config: classic() });
    const id = body.lobby.id;
    await api(bob, "POST", `/api/lobbies/${id}/join`, { role: "player" });
    await api(ann, "POST", `/api/lobbies/${id}/start`);
    expect((await t.services.lobbies.action(ann.user, id, { type: "place", row: 1, col: 1 })).ok).toBe(true);
    expect((await t.services.lobbies.action(bob.user, id, { type: "place", row: 0, col: 0 })).ok).toBe(true);
    await t.close();

    t = await createTestApp();
    expect(await t.services.lobbies.restoreAll()).toEqual({ restored: 1, aborted: 0 });
    const summary = await t.services.lobbies.matchSummary(id);
    expect(summary).toMatchObject({ phase: "playing", round: 1 });
    expect((await t.services.lobbies.action(bob.user, id, { type: "place", row: 2, col: 2 })).ok).toBe(false);
    expect((await t.services.lobbies.action(ann.user, id, { type: "place", row: 2, col: 2 })).ok).toBe(true);
  });
});
