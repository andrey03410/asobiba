import type { ServerMessage } from "@asobiba/api";
import { quizor } from "@asobiba/game-quizor";
import { ticTacToe } from "@asobiba/game-tic-tac-toe";
import { presetDocument } from "@asobiba/sdk";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestApp, resetDb, signUp, type TestApp } from "../test/helpers";

let test: TestApp;
let now: number;
beforeEach(async () => {
  now = Date.now();
  test = await createTestApp({ now: () => now });
  await resetDb(test.db);
});
afterEach(async () => { await test.close(); });

it("delivers a public event and disconnect notice without pausing the game", async () => {
  const owner = await signUp(test, "ai-owner");
  const player = await signUp(test, "ai-player");
  const lobbies = test.services.lobbies;
  const lobby = await lobbies.create(owner.user, { config: presetDocument(ticTacToe, ticTacToe.presets[0]) }, true);
  const attachment = await lobbies.agentAttach(owner.user, lobby.id, { role: "commentator", instructions: "Итог раунда" });
  const first = await lobbies.agentWait(owner.user, lobby.id, attachment.key, 0, 0);
  expect(first.event?.kind).toBe("waiting");
  await expect(lobbies.agentWait(player.user, lobby.id, attachment.key, 0, 0)).rejects.toMatchObject({ status: 403 });
  await lobbies.join(player.user, lobby.id, "player");
  const waiting = lobbies.agentWait(owner.user, lobby.id, attachment.key, first.event!.cursor, 2000);
  await lobbies.start(owner.user, lobby.id);
  const playing = await waiting;
  expect(playing.event).toMatchObject({ kind: "observation" });
  await lobbies.agentDetach(owner.user, lobby.id, attachment.key);
  expect(await lobbies.get(lobby.id)).toMatchObject({ agent: { status: "disconnected" }, agentNotice: "ИИ-комментатор отключился" });
  expect(await lobbies.action(owner.user, lobby.id, { type: "place", row: 0, col: 0 })).toEqual({ ok: true });
});

it.each(["reconnect", "human", "algorithm", "finish", "handoff-retry", "restart"] as const)("recovers a disconnected presenter through %s", async (mode) => {
  const owner = await signUp(test, "quiz-owner");
  const spectator = await signUp(test, "quiz-spectator");
  const lobbies = test.services.lobbies;
  const config = presetDocument(quizor, quizor.presets[0]);
  config.rules = {
    presenter: "required",
    defaults: { judge: "presenter", advance: "presenter" },
    rounds: [{ id: "first", questions: [{ id: "first-q", prompt: "Столица Японии", fields: [
      { id: "answer", type: "text", answers: [{ text: "Токио" }] },
    ] }] }],
  };
  const { id } = await lobbies.create(owner.user, { config, agent: { role: "presenter" } }, true);
  await lobbies.join(spectator.user, id, "spectator");
  const views: ServerMessage[] = [];
  await lobbies.subscribe({ userId: owner.user.id, send: (msg) => views.push(msg) }, id);
  const spectatorSocket = { userId: spectator.user.id, send: () => {} };
  await lobbies.subscribe(spectatorSocket, id);
  await expect(lobbies.start(owner.user, id)).rejects.toMatchObject({ code: "presenter_offline" });
  const { key } = await lobbies.agentAttach(owner.user, id);
  await lobbies.start(owner.user, id);
  const started = await test.db.match.findFirstOrThrow({ where: { lobbyId: id } });
  const latest = () => views.filter((msg) => msg.type === "match").at(-1)?.match;
  if (mode === "restart") {
    now += 2_000;
    await lobbies.action(owner.user, id, { type: "unknown" });
    expect(latest()?.game).toMatchObject({ phase: "preload" });
    now += 10_000;
    await lobbies.agentWait(owner.user, id, key, 0, 0);
    expect(latest()?.game).toMatchObject({ phase: "answer" });
    const before = latest()?.game;
    now += 10_000;
    await lobbies.agentWait(owner.user, id, key, 0, 0);
    const checkpoint = now;
    lobbies.shutdown();
    now += 60_000;
    expect(await lobbies.restoreAll()).toEqual({ restored: 1, aborted: 0 });
    await lobbies.subscribe({ userId: owner.user.id, send: (msg) => views.push(msg) }, id);
    expect(latest()).toMatchObject({ pause: { reason: "presenter-disconnected", since: checkpoint }, game: before });
    return;
  }
  expect((started.log as unknown[])[0]).toMatchObject({ at: started.startedAt.getTime(), action: { type: "presenter-presence", online: true } });
  await lobbies.agentDetach(owner.user, id, key);
  expect(views.filter((msg) => msg.type === "match").at(-1)?.match?.pause?.reason).toBe("presenter-disconnected");
  await expect(lobbies.pause(owner.user, id, false)).rejects.toMatchObject({ code: "presenter_offline" });
  await expect(lobbies.agentWait(owner.user, id, key, 0, 0)).rejects.toMatchObject({ code: "forbidden" });

  await lobbies.manageAgent(owner.user, id, mode === "human" || mode === "handoff-retry"
    ? { action: "human", userId: spectator.user.id } : { action: mode });
  if (mode === "handoff-retry") {
    lobbies.unsubscribe(spectatorSocket, id);
    await expect(lobbies.pause(owner.user, id, false)).rejects.toMatchObject({ code: "presenter_offline" });
    await expect(lobbies.manageAgent(owner.user, id, { action: "algorithm" })).resolves.toMatchObject({ status: "playing" });
  }
  if (mode === "finish") {
    expect(await lobbies.get(id)).toMatchObject({ status: "finished" });
    expect(await test.db.match.findFirst({ where: { lobbyId: id } })).toMatchObject({ status: "aborted" });
    return;
  }
  if (mode === "reconnect") expect((await lobbies.agentAttach(owner.user, id)).key).not.toBe(key);
  await lobbies.pause(owner.user, id, false);
  expect(views.filter((msg) => msg.type === "match").at(-1)?.match?.pause).toBeUndefined();
  if (mode === "human") expect((await lobbies.get(id)).members).toContainEqual(expect.objectContaining({ userId: spectator.user.id, role: "presenter" }));
  if (mode === "algorithm") expect((await lobbies.get(id)).agent).toBeUndefined();
});

it("restricts a generic pause and the original config to the lobby owner", async () => {
  const owner = await signUp(test, "pause-owner");
  const player = await signUp(test, "pause-player");
  const lobbies = test.services.lobbies;
  const lobby = await lobbies.create(owner.user, { config: presetDocument(ticTacToe, ticTacToe.presets[0]) }, true);
  await lobbies.join(player.user, lobby.id, "player");
  await lobbies.start(owner.user, lobby.id);
  const path = `/api/lobbies/${lobby.id}`;
  const pause = (cookie: string, paused: boolean) => test.app.inject({ method: "POST", url: `${path}/pause`, headers: { cookie }, payload: { paused } });
  expect((await pause(player.cookie, true)).statusCode).toBe(403);
  expect((await pause(owner.cookie, true)).statusCode).toBe(200);
  now += 10_000;
  expect(await lobbies.action(owner.user, lobby.id, { type: "place", row: 0, col: 0 })).toMatchObject({ ok: false, error: { code: "paused" } });
  expect((await pause(owner.cookie, false)).statusCode).toBe(200);
  expect((await test.app.inject({ url: `${path}/config/original`, headers: { cookie: player.cookie } })).statusCode).toBe(403);
  const original = await test.app.inject({ url: `${path}/config/original`, headers: { cookie: owner.cookie } });
  expect(original.json()).toMatchObject({ config: { game: "tic-tac-toe" } });
});
