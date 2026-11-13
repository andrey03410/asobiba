import type { ServerMessage } from "@asobiba/api";
import type { QuizorView } from "@asobiba/game-quizor";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createTestApp, resetDb, signUp, type TestApp, type TestUser } from "../test/helpers";

type MatchMessage = Extract<ServerMessage, { type: "match" }>;
let t: TestApp;
let clock: number;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  clock = 1_000_000;
  t = await createTestApp({ now: () => clock });
  await resetDb(t.db);
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await t?.close();
});

async function readMatch(base: string, user: TestUser, lobbyId: string): Promise<MatchMessage> {
  const socket = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { cookie: user.cookie } });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const message = new Promise<MatchMessage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No match snapshot after subscribing")), 3000);
    socket.on("message", raw => {
      const received = JSON.parse(raw.toString()) as ServerMessage;
      if (received.type === "match") { clearTimeout(timer); resolve(received); }
    });
  });
  socket.send(JSON.stringify({ type: "subscribe", lobbyId }));
  return message;
}

const latestMatch = (messages: ServerMessage[]): MatchMessage => messages.filter((message): message is MatchMessage => message.type === "match").at(-1)!;

describe("finished match recovery", () => {
  it.each([true, false])("restores Quizor review over HTTP and WebSocket with showAnswers=%s", async showAnswers => {
    const host = await signUp(t, "ann");
    const departed = await signUp(t, "bob");
    const player = await signUp(t, "carol");
    const lead = await signUp(t, "lead");
    const viewer = await signUp(t, "viewer");
    const lobby = await t.services.lobbies.create(host.user, { name: "Saved review", config: {
      sdk: 1, game: "quizor", gameVersion: 1,
      rules: {
        presenter: "optional",
        defaults: { showAnswers, judge: "algorithm", advance: "presenter", timers: { preloadSeconds: 0, revealSeconds: 1 } },
        rounds: [{ id: "r", questions: [{
          id: "q", prompt: "Столица России?",
          fields: [{ id: "a", type: "text", answers: [{ text: "Москва" }], notes: "Секретная памятка ведущего" }],
        }] }],
      },
    } });
    // Seats follow joinedAt (millisecond default): keep the joins in distinct milliseconds.
    for (const person of [departed, player]) {
      await t.services.lobbies.join(person.user, lobby.id, "player");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    for (const person of [lead, viewer]) await t.services.lobbies.join(person.user, lobby.id, "spectator");
    await t.services.lobbies.setPresenter(host.user, lobby.id, lead.user.id);
    const before: ServerMessage[] = [];
    for (const person of [host, departed, player, lead]) await t.services.lobbies.subscribe({ userId: person.user.id, send: message => { if (person === player) before.push(message); } }, lobby.id);
    await t.services.lobbies.start(host.user, lobby.id);
    clock += 2;
    for (const [person, answer] of [[host, "Москва"], [departed, "Париж"], [player, "Берлин"]] as const) {
      expect(await t.services.lobbies.action(person.user, lobby.id, { type: "answer", answers: { a: answer } })).toEqual({ ok: true });
    }
    expect(await t.services.lobbies.control(lead.user, lobby.id, { type: "next" })).toEqual({ ok: true });
    const expected = latestMatch(before).match;
    expect(expected).toMatchObject({ phase: "finished", seats: 3, game: { history: [{ questionId: "q", reference: "Москва" }] } });
    const persisted = await t.db.match.findFirstOrThrow({ where: { lobbyId: lobby.id } });
    expect(persisted.status).toBe("finished");
    // The historical second seat disappears from the roster; the third must stay third.
    await t.services.lobbies.leave(departed.user, lobby.id);
    await t.services.lobbies.setPresenter(host.user, lobby.id, null);
    await t.close();
    clock += 60_000;
    t = await createTestApp({ now: () => clock });
    expect(await t.services.lobbies.restoreAll()).toEqual({ restored: 0, aborted: 0 });
    const response = await t.app.inject({ url: `/api/lobbies/${lobby.id}`, headers: { cookie: player.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().lobby).toMatchObject({ status: "finished", seatNames: ["ann", "bob", "carol"] });
    expect(response.json().lobby.members.find((member: { userId: string }) => member.userId === player.user.id)).toMatchObject({ role: "player", seat: 2 });
    expect(await t.services.lobbies.matchSummary(lobby.id)).toMatchObject({ phase: "finished", result: { winners: [0] } });
    const base = await t.listen();
    const restored = await readMatch(base, player, lobby.id);
    expect(restored.seat).toBe(2);
    expect(restored.match).toEqual(expected);
    for (const person of [departed, lead, viewer]) {
      const observed = await readMatch(base, person, lobby.id);
      expect(observed).toMatchObject({ seat: null, match: { phase: "finished" } });
      expect(observed.controlRole).toBeUndefined();
      const view = observed.match!.game as QuizorView;
      expect(view.history[0].answers).toHaveLength(showAnswers ? 3 : 0);
      expect(JSON.stringify(view)).not.toContain("Секретная памятка ведущего");
    }
    await t.services.lobbies.join(departed.user, lobby.id, "spectator");
    const returnedSpectator = await readMatch(base, departed, lobby.id);
    expect(returnedSpectator.seat).toBeNull();
    expect((returnedSpectator.match!.game as QuizorView).history[0].answers).toHaveLength(showAnswers ? 3 : 0);
    const playerView = restored.match!.game as QuizorView;
    expect(playerView.history[0].answers.map(answer => answer.seat)).toEqual(showAnswers ? [0, 1, 2] : [2]);
    // Read-only recovery must not rewrite result, finish time, log or seat snapshots.
    expect(await t.db.match.findUniqueOrThrow({ where: { id: persisted.id } })).toEqual(persisted);
    expect((await t.services.lobbies.get(lobby.id)).status).toBe("finished");
  });
});
