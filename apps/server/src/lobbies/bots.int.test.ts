import { quizor } from "@asobiba/game-quizor";
import { ticTacToe } from "@asobiba/game-tic-tac-toe";
import { yomifuda } from "@asobiba/game-yomifuda";
import { presetDocument } from "@asobiba/sdk";
import { afterEach, beforeEach, expect, it } from "vitest";
import { randomString } from "../ids";
import { createTestApp, resetDb, signUp, type TestApp } from "../test/helpers";

let test: TestApp;
let now: number;
beforeEach(async () => {
  now = Date.now();
  test = await createTestApp({ now: () => now });
  await resetDb(test.db);
});
afterEach(async () => { await test.close(); });

it("atomically reserves one seat, claims it once and restores only its occupant", async () => {
  const { user } = await signUp(test, "bot-host");
  const svc = test.services.lobbies;
  const { lobby, inviteUrl, userId } = await svc.createWithBot(user, { config: presetDocument(ticTacToe, ticTacToe.presets[0]) }, { name: "Рин", difficulty: "high" });
  expect(lobby.members).toHaveLength(2);
  expect(lobby.members[1]).toMatchObject({ userId, login: "Рин · ИИ №1", bot: { status: "reserved", difficulty: "high" } });
  const claim = { name: "Рин", attempt: randomString(36) };
  await expect(svc.joinBot(lobby.url, claim)).rejects.toMatchObject({code: "lobby_full"});
  await expect(svc.start(user, lobby.id)).rejects.toMatchObject({code: "bot_reserved"});
  const player = await svc.joinBot(inviteUrl, claim);
  expect(player.key).toMatch(/^asp_/);
  expect(await svc.joinBot(inviteUrl, claim)).toMatchObject({ userId, key: player.key });
  await expect(svc.joinBot(inviteUrl, { ...claim, attempt: randomString(36) })).rejects.toMatchObject({code: "invalid_bot_invite"});
  expect(JSON.stringify(await svc.get(lobby.id))).not.toContain(player.key);
  await svc.botDetach(lobby.id, player.key);
  expect((await svc.get(lobby.id)).members[1]?.bot?.status).toBe("disconnected");
  expect((await svc.botWait(lobby.id, player.key, 0, 0)).event?.kind).toBe("waiting");
  expect((await svc.get(lobby.id)).members[1]?.bot?.status).toBe("connected");
});

it("serializes joins for the last seat and rejects repeating a decision", async () => {
  const { user } = await signUp(test, "bot-host");
  const svc = test.services.lobbies;
  const config = presetDocument(ticTacToe, ticTacToe.presets[0]);
  const lobby = await svc.create(user,{config});
  const opts = {name:"Рин",attempt:randomString(40)};
  const attempts = await Promise.allSettled([svc.joinBot(lobby.url,opts),svc.joinBot(lobby.url,{...opts,attempt:randomString(40)})]);
  expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const player = await svc.joinBot(lobby.url, opts);
  await svc.start(user,lobby.id);
  const hostMove = await svc.action(user,lobby.id,{type:"place",row:0,col:0});
  expect(hostMove.ok).toBe(true);
  const event = (await svc.botWait(lobby.id,player.key,0,0)).event!;
  expect(event.kind).toBe("turn");
  const a = await Promise.allSettled([svc.botAct(lobby.id, player.key,event.cursor,{type:"place",row:1,col:1}),svc.botAct(lobby.id,player.key,event.cursor,{type:"place",row:2,col:2})]);
  expect(a.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const saved = await test.db.match.findFirstOrThrow({where:{lobbyId:lobby.id}});
  expect((saved.log as unknown[]).length).toBe(2);
  await expect(svc.removeBot(user,lobby.id,player.userId)).rejects.toMatchObject({code:"match_in_progress"});
});

it("isolates two equally named players' forms and hands, including across restart", async () => {
  const {user} = await signUp(test, "cards-host");
  const svc = test.services.lobbies;
  const {url,id} = await svc.create(user,{config:presetDocument(yomifuda,yomifuda.presets[0])});
  const controller = (await test.services.auth.createToken(user.id, "Cards", "player")).token.id;
  const first = await svc.joinBot(url,{name:"Рин",attempt:randomString(40)} ,user,controller);
  await expect(svc.joinBot(url,{name:"Рин",attempt:randomString(40)},user,controller)).rejects.toMatchObject({code:"bot_already_seated"});
  const second = await svc.joinBot(url,{name:"Рин",attempt:randomString(40)});
  expect([first.member.login,second.member.login]).toEqual(["Рин · ИИ №1","Рин · ИИ №2"]);
  await expect(svc.botWait(id,first.key,0,0)).rejects.toMatchObject({status:403});
  await expect(svc.botIdentity(id,second.key,controller)).rejects.toMatchObject({status:403});
  await svc.start(user,id);
  const see = async (key:string, controller?:string) => (await svc.botWait(id,key,0,0,undefined,controller)).event!;
  const a = await see(first.key,controller);
  const b = await see(second.key);
  const hand = (event: typeof a) => event.actions.map(form => String(form.fields?.cardId));
  expect(hand(a)).toHaveLength(3);
  expect(hand(b)).toHaveLength(3);
  for (const id of hand(a)) expect(JSON.stringify(b)).not.toContain('"'+id+'"');
  for (const id of hand(b)) expect(JSON.stringify(a)).not.toContain('"'+id+'"');
  svc.shutdown();
  expect(await svc.restoreAll()).toMatchObject({restored:1});
  const restored = await see(first.key,controller);
  expect(hand(restored)).toEqual(hand(a));
  await expect(svc.botAct(id,first.key,a.cursor,{type:"play",...a.actions[0]?.fields},controller)).rejects.toMatchObject({code:"stale_agent_event"});
});

it("revokes a removed bot, keeps numbers unique and cancels an outstanding wait", async () => {
  const {user} = await signUp(test,"bot-host");
  const svc = test.services.lobbies;
  const lobby = await svc.create(user,{config:presetDocument(ticTacToe,ticTacToe.presets[0])});
  const input = {name:"Рин",attempt:randomString(40)};
  const first = await svc.joinBot(lobby.url,input);
  const {event} = await svc.botWait(lobby.id,first.key,0,0);
  const pending = svc.botWait(lobby.id,first.key,event!.cursor,2000);
  await svc.botDetach(lobby.id,first.key);
  await expect(pending).rejects.toMatchObject({code:"bot_disconnected"});
  await svc.removeBot(user,lobby.id,first.userId);
  await expect(svc.joinBot(lobby.url,input)).rejects.toMatchObject({status:403});
  await expect(svc.botIdentity(lobby.id,first.key)).rejects.toMatchObject({status:403});
  const next = await svc.joinBot(lobby.url,{...input,attempt:randomString(40)});
  expect(next.member.bot?.number).toBe(2);
});

it("enforces the site guest policy on joins, actions and reconnects", async () => {
  const {user} = await signUp(test,"bot-host");
  const svc = test.services.lobbies;
  const lobby = await svc.create(user,{config:presetDocument(ticTacToe,ticTacToe.presets[0])});
  const opts = {name:"Рин",attempt:randomString(40)};
  const player = await svc.joinBot(lobby.url,opts);
  test.services.env.provisionedAccountsOnly = true;
  await expect(svc.botWait(lobby.id,player.key,0,0)).rejects.toMatchObject({status:403});
  await expect(svc.botAct(lobby.id,player.key,123,{type:"ready"})).rejects.toMatchObject({status:403});
  await expect(svc.joinBot(lobby.url,opts)).rejects.toMatchObject({status:403});
});

it("admits a friend's authenticated player in accounts-only mode and binds the seat to their token", async () => {
  const owner = (await signUp(test, "owner")).user;
  const friend = (await signUp(test, "friend")).user;
  const { auth, lobbies, env } = test.services;
  const controller = (await auth.createToken(friend.id, "Player", "player")).token.id;
  const organizer = (await auth.createToken(friend.id, "Organizer", "organizer")).token.id;
  const lobby = await lobbies.create(owner, { config: presetDocument(ticTacToe, ticTacToe.presets[0]) });
  env.provisionedAccountsOnly = true;
  const options = { name: "Рин", attempt: randomString(40) };
  await expect(lobbies.joinBot(lobby.url, options)).rejects.toMatchObject({ status: 403 });
  await expect(lobbies.joinBot(lobby.url, options, friend, organizer)).rejects.toMatchObject({ status: 403 });
  await expect(lobbies.joinBot(lobby.url, options, owner, controller)).rejects.toMatchObject({ status: 403 });

  const player = await lobbies.joinBot(lobby.url, options, friend, controller);
  const event = await lobbies.botWait(lobby.id, player.key, 0, 0, undefined, controller);
  expect(event.event?.kind).toBe("waiting");
  await expect(lobbies.botWait(lobby.id, player.key, 0, 0)).rejects.toMatchObject({ status: 403 });
  await auth.revokeToken(friend.id, controller);
  await expect(lobbies.botWait(lobby.id, player.key, 0, 0, undefined, controller)).rejects.toMatchObject({ status: 403 });
});

it("hides the paused Quizor board from the player media channel", async () => {
  const { user } = await signUp(test, "quiz-host");
  const svc = test.services.lobbies;
  const lobby = await svc.create(user, { config: presetDocument(quizor, quizor.presets[0]) });
  const bot = await svc.joinBot(lobby.url, { name: "Рин", attempt: randomString(40) });
  await svc.start(user, lobby.id);
  expect((await svc.botMediaView(lobby.id, bot.key)).view).not.toBeNull();
  await svc.pause(user, lobby.id, true);
  expect((await svc.botMediaView(lobby.id, bot.key)).view).toBeNull();
  expect((await svc.botWait(lobby.id, bot.key, 0, 0)).event?.state).not.toHaveProperty("game");
});
