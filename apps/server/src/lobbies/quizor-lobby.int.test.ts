import type { ServerMessage } from "@asobiba/api";
import type { QuizorView } from "@asobiba/game-quizor";
import { actionError, defineGame, presetDocument } from "@asobiba/sdk";
import { raceGame } from "../../../../packages/sdk/src/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import WebSocket from "ws";
import { createTestApp, resetDb, signUp, SIMPLE_SVG, type TestApp, type TestUser } from "../test/helpers";

let t: TestApp;
const game = defineGame({
  id: "quizor", version: 1, title: "Quizor protocol fixture", summary: "Trusted control fixture", kind: "turn",
  visualSchema: raceGame.visualSchema, actionSchema: z.union([raceGame.actionSchema, z.strictObject({ type: z.literal("answer"), answers: z.record(z.string(), z.string()) })]),
  guide: "", presets: [], slots: [], themes: [], visualCatalog: {},
  seats: () => ({ min: 1, max: 16 }),
  rulesSchema: z.object({ presenter: z.enum(["none", "optional", "required"]).default("optional"), current: z.object({ asset: z.string() }).optional(), future: z.object({ asset: z.string() }).optional(), endAt: z.number().optional() }),
  presentRules: (rules) => ({ presenter: rules.presenter }),
  turnBudgetSeconds: () => 0,
  setup: (ctx) => ({ paused: false, revealed: false, finished: false, seats: ctx.seats, ownAnswer: null as Record<string,string> | null, endAt: ctx.rules.endAt, asset: ctx.rules.current?.asset ?? "ast_visible", present: [] as number[] }),
  nextWakeAt: (state) => !state.finished ? state.endAt ?? null : null,
  wake: (state) => ({ ...state, finished: true }),
  currentSeats: (state) => Array.from({ length: state.seats }, (_, seat) => seat), legalActions: () => [{ add: 1 as const }],
  applyAction: (state, _seat, action) => "answers" in action ? { ...state, ownAnswer: action.answers } : state, roundResult: (state) => state.finished ? { winners: [0], losers: [], draw: false, reason: "done" } : null,
  applyControl: (state, raw, ctx) => {
    const action = raw as { type: string; seat?: number; online?: boolean };
    if (ctx.role === "system") return action.type === "presence" ? { ...state, present: action.online ? [...new Set([...state.present, action.seat!])] : state.present.filter(seat => seat !== action.seat) } : actionError("forbidden_control", "Нет прав");
    if (ctx.role === "presenter" && action.type === "finish") return { ...state, finished: true };
    if (action.type === "pause") return { ...state, paused: true };
    if (ctx.role === "presenter" && action.type === "reveal") return { ...state, revealed: true };
    return actionError("forbidden_control", "Нет прав");
  },
  view: (state) => ({ ...state, blocks: [{ type: "image", asset: state.asset }] }),
  presenterView: (state) => ({ ...state, blocks: [{ type: "image", asset: state.asset }], secret: "answer" }),
});

beforeEach(async () => {
  t = await createTestApp(); await resetDb(t.db);
  const get = t.services.catalog.get.bind(t.services.catalog);
  vi.spyOn(t.services.catalog, "get").mockImplementation((id) => id === "quizor" ? game : get(id));
});
afterEach(async () => { vi.restoreAllMocks(); await t?.close(); });
async function api(user: TestUser, url: string, payload?: unknown) {
  const response = await t.app.inject({ method: "POST", url, headers: { cookie: user.cookie }, payload: payload as never });
  return { status: response.statusCode, body: response.json() };
}
async function setup(presenter: "none" | "optional" | "required" = "optional") {
  const host = await signUp(t, "host"); const player = await signUp(t, "player"); const lead = await signUp(t, "lead");
  const config = presetDocument(game); config.rules = game.rulesSchema.parse({ presenter });
  const lobby = await t.services.lobbies.create(host.user, { name: "Quiz", config });
  await t.services.lobbies.join(player.user, lobby.id, "player");
  await t.services.lobbies.join(lead.user, lobby.id, "spectator");
  return { host, player, lead, id: lobby.id };
}

describe("trusted lobby control", () => {
  it("appoints one nonplaying presenter before the match and enforces required/none", async () => {
    const { host, player, lead, id } = await setup("required");
    expect((await api(host, `/api/lobbies/${id}/start`)).body.error?.code).toBe("presenter_required");
    expect((await api(player, `/api/lobbies/${id}/presenter`, { userId: lead.user.id })).status).toBe(403);
    expect((await api(host, `/api/lobbies/${id}/presenter`, { userId: player.user.id })).body.error?.code).toBe("presenter_is_player");
    const assigned = await api(host, `/api/lobbies/${id}/presenter`, { userId: lead.user.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.lobby.members.find((m: any) => m.userId === lead.user.id)).toMatchObject({ role: "presenter", seat: null });
    expect((await api(host, `/api/lobbies/${id}/start`)).status).toBe(200);
    const match = await t.db.match.findFirstOrThrow({ where: { lobbyId: id } });
    expect(match.seatUsers).toEqual([host.user.id, player.user.id]);
    expect((await api(host, `/api/lobbies/${id}/presenter`, { userId: null })).status).toBe(409);

  });

  it("rejects presenters when the quiz disables them", async () => {
    const { host, lead, id } = await setup("none");
    expect((await api(host, `/api/lobbies/${id}/presenter`, { userId: lead.user.id })).body.error?.code).toBe("no_presenter");
  });

  it("keeps host and presenter capabilities separate and never trusts payload roles", async () => {
    const { host, player, lead, id } = await setup();
    await api(host, `/api/lobbies/${id}/presenter`, { userId: lead.user.id });
    const views: ServerMessage[] = [];
    await t.services.lobbies.subscribe({ userId: lead.user.id, send: (m) => views.push(m) }, id);
    await t.services.lobbies.start(host.user, id);
    const last = views.filter((m) => m.type === "match").at(-1) as Extract<ServerMessage, { type: "match" }>;
    expect(last).toMatchObject({ seat: null, controlRole: "presenter", match: { game: { secret: "answer" } } });
    expect(await t.services.lobbies.control(player.user, id, { type: "reveal", role: "presenter" })).toMatchObject({ ok: false, error: { code: "forbidden_control" } });
    expect(await t.services.lobbies.control(host.user, id, { type: "reveal", role: "presenter" })).toMatchObject({ ok: false, error: { code: "forbidden_control" } });
    expect(await t.services.lobbies.control(host.user, id, { type: "presence", seat: 0, online: false, role: "system" })).toMatchObject({ ok: false, error: { code: "forbidden_control" } });
    expect(await t.services.lobbies.control(host.user, id, { type: "pause" })).toEqual({ ok: true });
    expect(await t.services.lobbies.control(lead.user, id, { type: "reveal" })).toEqual({ ok: true });
    await expect(t.services.lobbies.endGuest(lead.user.id, false)).rejects.toMatchObject({ code: "active_guest_matches" });
    expect(await t.services.lobbies.action(lead.user, id, { add: 1 })).toMatchObject({ ok: false, error: { code: "not_a_player" } });
    const row = await t.db.match.findFirstOrThrow({ where: { lobbyId: id } });
    expect(row.log).toEqual(expect.arrayContaining([expect.objectContaining({ seat: -1, controlRole: "host" }), expect.objectContaining({ seat: -1, controlRole: "presenter" })]));
  });

  it("derives presence from distinct live subscribers and journals it", async () => {
    const { host, player, id } = await setup();
    const sub = { userId: player.user.id, send: () => {} };
    const duplicate = { userId: player.user.id, send: () => {} };
    await t.services.lobbies.subscribe(sub, id);
    await t.services.lobbies.start(host.user, id);
    await t.services.lobbies.subscribe(duplicate, id);
    t.services.lobbies.unsubscribe(sub, id);
    await t.services.lobbies.get(id); // queued leave settles before this read's DB request
    let row = await t.db.match.findFirstOrThrow({ where: { lobbyId: id } });
    expect(row.log).toEqual(expect.arrayContaining([expect.objectContaining({ controlRole: "system", action: { type: "presence", seat: 1, online: true } })]));
    t.services.lobbies.unsubscribe(duplicate, id);
    await t.services.lobbies.control(host.user, id, { type: "pause" });
    row = await t.db.match.findFirstOrThrow({ where: { lobbyId: id } });
    expect(row.log).toEqual(expect.arrayContaining([expect.objectContaining({ controlRole: "system", action: { type: "presence", seat: 1, online: false } })]));
  });

  it("authorizes WebSocket controls independently of supplied actor fields", async () => {
    const { host, player, lead, id } = await setup();
    await api(host, `/api/lobbies/${id}/presenter`, { userId: lead.user.id });
    await t.services.lobbies.start(host.user, id);
    const base = await t.listen();
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { cookie: player.cookie } });
    await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    try {
      const response = new Promise<ServerMessage>((resolve) => ws.once("message", raw => resolve(JSON.parse(raw.toString()))));
      ws.send(JSON.stringify({ type: "control", lobbyId: id, role: "presenter", action: { type: "reveal", role: "presenter" } }));
      expect(await response).toMatchObject({ type: "error", code: "forbidden_control" });
    } finally { ws.close(); }
  });

  it("persists a due game ending discovered during a presence update", async () => {
    await t.close();
    let clock = 1_000_000;
    t = await createTestApp({ now: () => clock });
    const host = await signUp(t, "host");
    const config = presetDocument(game); config.rules = game.rulesSchema.parse({ endAt: clock + 100 });
    const lobby = await t.services.lobbies.create(host.user, { name: "Late subscribe", config });
    await t.services.lobbies.start(host.user, lobby.id);
    clock += 200;
    const messages: ServerMessage[] = [];
    await t.services.lobbies.subscribe({ userId: host.user.id, send: message => messages.push(message) }, lobby.id);
    expect((await t.services.lobbies.get(lobby.id)).status).toBe("finished");
    const latestLobby = messages.filter(message => message.type === "lobby").at(-1) as Extract<ServerMessage, { type: "lobby" }>;
    expect(latestLobby.lobby.status).toBe("finished");
    expect(messages.filter(message => message.type === "match").at(-1)).toMatchObject({ match: { phase: "finished" } });
  });

  it("denies guessed future assets to an account while the owner retains access", async () => {
    const host = await signUp(t, "host"); const player = await signUp(t, "player");
    const current = await t.services.assets.createFromSvg(host.user.id, "now", SIMPLE_SVG);
    const future = await t.services.assets.createFromSvg(host.user.id, "later", SIMPLE_SVG);
    const config = presetDocument(game); config.rules = game.rulesSchema.parse({ current: { asset: current.id }, future: { asset: future.id } });
    const lobby = await t.services.lobbies.create(host.user, { name: "Secret", config });
    await t.services.lobbies.join(player.user, lobby.id, "spectator");
    expect(await t.services.lobbies.canReadAsset(host.user.id, future.id)).toBe(true);
    expect(await t.services.lobbies.canReadAsset(player.user.id, future.id)).toBe(false);
    expect((await t.app.inject({ url: future.url, headers: { cookie: player.cookie } })).statusCode).toBe(403);
    await t.services.lobbies.start(host.user, lobby.id);
    expect(await t.services.lobbies.canReadAsset(player.user.id, current.id)).toBe(true);
    expect((await t.app.inject({ url: current.url, headers: { cookie: player.cookie } })).statusCode).toBe(200);
    const outsider = await signUp(t, "outsider");
    expect(await t.services.lobbies.canReadAsset(outsider.user.id, current.id)).toBe(false);
    await t.services.lobbies.visit(outsider.user, lobby.id);
    expect(await t.services.lobbies.canReadAsset(outsider.user.id, current.id)).toBe(true);
    expect(await t.services.lobbies.canReadAsset(outsider.user.id, future.id)).toBe(false);
  });

  it("does not treat player answers as trusted media references", async () => {
    const host = await signUp(t, "host"); const player = await signUp(t, "player");
    const future = await t.services.assets.createFromSvg(host.user.id, "secret", SIMPLE_SVG);
    const config = presetDocument(game); config.rules = game.rulesSchema.parse({ future: { asset: future.id } });
    const lobby = await t.services.lobbies.create(host.user, { name: "Spoofed reference", config });
    await t.services.lobbies.join(player.user, lobby.id, "player");
    await t.services.lobbies.start(host.user, lobby.id);
    expect(await t.services.lobbies.action(player.user, lobby.id, { type: "answer", answers: { asset: future.id } })).toEqual({ ok: true });
    expect(await t.services.lobbies.canReadAsset(player.user.id, future.id)).toBe(false);
  });

  it("keeps only disclosed file access after a finished match is reloaded", async () => {
    const host = await signUp(t, "host"); const viewer = await signUp(t, "viewer"); const lead = await signUp(t, "lead");
    const current = await t.services.assets.createFromSvg(host.user.id, "now", SIMPLE_SVG);
    const future = await t.services.assets.createFromSvg(host.user.id, "later", SIMPLE_SVG);
    const config = presetDocument(game); config.rules = game.rulesSchema.parse({ current: { asset: current.id }, future: { asset: future.id } });
    const lobby = await t.services.lobbies.create(host.user, { name: "Replay files", config });
    await t.services.lobbies.join(viewer.user, lobby.id, "spectator");
    await t.services.lobbies.join(lead.user, lobby.id, "spectator");
    await t.services.lobbies.setPresenter(host.user, lobby.id, lead.user.id);
    await t.services.lobbies.start(host.user, lobby.id);
    expect(await t.services.lobbies.control(lead.user, lobby.id, { type: "finish" })).toEqual({ ok: true });
    await t.close(); t = await createTestApp();
    expect(await t.services.lobbies.canReadAsset(viewer.user.id, current.id)).toBe(true);
    expect(await t.services.lobbies.canReadAsset(viewer.user.id, future.id)).toBe(false);
  });


  it("restores a real paused Quizor and resets membership presence to actual subscribers", async () => {
    vi.restoreAllMocks();
    await t.close();
    let clock = 1_000_000;
    t = await createTestApp({ now: () => clock });
    const host = await signUp(t, "host"); const player = await signUp(t, "player"); const lead = await signUp(t, "lead");
    const lobby = await t.services.lobbies.create(host.user, { name: "Actual Quizor", config: {
      sdk: 1, game: "quizor", gameVersion: 1,
      rules: { presenter: "required", defaults: { timers: { answerSeconds: 10, preloadSeconds: 0 } }, rounds: [{ id: "r", questions: [
        { id: "q", prompt: "Столица?", fields: [{ id: "a", type: "text", answers: [{ text: "Москва" }] }] },
        { id: "future", prompt: "Будущий секрет", fields: [{ id: "a", type: "number", target: 42 }] },
      ] }] },
    } });
    await t.services.lobbies.join(player.user, lobby.id, "player");
    await t.services.lobbies.join(lead.user, lobby.id, "spectator");
    await t.services.lobbies.setPresenter(host.user, lobby.id, lead.user.id);
    const before: ServerMessage[] = [];
    for (const person of [host, player, lead]) await t.services.lobbies.subscribe({ userId: person.user.id, send: message => { if (person === player) before.push(message); } }, lobby.id);
    await t.services.lobbies.start(host.user, lobby.id);
    clock += 2; // pass the empty intro's 1 ms server deadline
    expect(await t.services.lobbies.control(host.user, lobby.id, { type: "pause" })).toEqual({ ok: true });
    const paused = before.filter(message => message.type === "match").at(-1) as Extract<ServerMessage, { type: "match" }>;
    expect(paused.match?.game).toMatchObject({ phase: "answer", questionId: "q", paused: true });
    expect(JSON.stringify(paused.match?.game)).not.toContain("Москва");
    expect(JSON.stringify(paused.match?.game)).not.toContain("Будущий секрет");
    clock += 5000;
    await t.close(); t = await createTestApp({ now: () => clock });
    expect(await t.services.lobbies.restoreAll()).toEqual({ restored: 1, aborted: 0 });
    const log = (await t.db.match.findFirstOrThrow({ where: { lobbyId: lobby.id } })).log;
    expect(log).toEqual(expect.arrayContaining([expect.objectContaining({ controlRole: "system", action: { type: "presence", seat: 0, online: false } }), expect.objectContaining({ controlRole: "system", action: { type: "presence", seat: 1, online: false } })]));
    const after: ServerMessage[] = [];
    await t.services.lobbies.subscribe({ userId: player.user.id, send: message => after.push(message) }, lobby.id);
    const latest = () => (after.filter(message => message.type === "match").at(-1) as Extract<ServerMessage, { type: "match" }>).match!.game as QuizorView;
    expect(latest()).toMatchObject({ phase: "answer", paused: true, players: [{ online: false }, { online: true }], presenterOnline: false });
    expect(await t.services.lobbies.control(host.user, lobby.id, { type: "resume" })).toEqual({ ok: true });
    expect(latest().resumeAt).toBe(1_008_002);
    clock += 3000;
    expect(await t.services.lobbies.control(host.user, lobby.id, { type: "resume" })).toEqual({ ok: true });
    expect(latest()).toMatchObject({ phase: "answer", paused: false, deadline: 1_018_001 });
    expect(await t.services.lobbies.action(player.user, lobby.id, { type: "answer", answers: { a: "Москва" } })).toEqual({ ok: true });
    expect(latest()).toMatchObject({ phase: "reveal", players: [{ score: 0 }, { score: 100 }] });
  });

});
