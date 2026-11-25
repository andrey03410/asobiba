import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { wavSeconds } from "../assets/media-fixtures";
import { createTestApp, resetDb, signUp, type TestApp } from "../test/helpers";
import type { Block } from "@asobiba/game-quizor";

let app: TestApp;
let guest: Client;
let owner: Awaited<ReturnType<typeof signUp>>;
let now: number;
beforeEach(async () => {
  now = Date.now();
  app = await createTestApp({ now: () => now });
  await resetDb(app.db);
  await app.listen();
  owner = await signUp(app, "quiz-media");
  guest = new Client({ name: "quiz-media", version: "1" });
  await guest.connect(new StreamableHTTPClientTransport(new URL("/mcp", app.url)));
});
afterEach(async () => {
  await guest.close();
  await app.close();
});

const call = async (name: string, args: Record<string, unknown> = {}) =>
  await guest.callTool({ name, arguments: args }) as CallToolResult;
async function json(name: string, args?: Record<string, unknown>) {
  const out = await call(name, args);
  expect(out.isError, JSON.stringify(out.content)).not.toBe(true);
  const block = out.content[0];
  if (block?.type !== "text") throw new Error("Expected JSON");
  return JSON.parse(block.text);
}
async function start(blocks: Block[], pacing: "self" | "auto", background?: string) {
  const lobby = await app.services.lobbies.create(owner.user, {
    config: {
      sdk: 1, game: "quizor", gameVersion: 1,
      rules: {
        players: { min: 2, max: 2 }, defaults: { pacing, timers: { preloadSeconds: 0 } },
        rounds: [{ id: "r", ...(background && { visual: { background: { asset: background } } }), questions: [{ id: "q", prompt: "Что показали?", blocks,
          fields: [{ id: "a", type: "text", answers: [{ text: "да" }] }] }] }],
      },
    },
  });
  const { attempt } = await json("agent_prepare_join");
  const { key } = await json("agent_join_by_link", { url: lobby.url, name: "Рин", attempt });
  const seat = { key, lobbyId: lobby.id };
  await app.services.lobbies.start(owner.user, lobby.id);
  const wait = async () => (await json("agent_wait", { ...seat, after: 0, timeoutMs: 0 })).event;
  for (let i = 0; i < 100; i++) {
    const event = await wait();
    if (event?.state?.game?.phase === "show") return { seat, wait };
    now += 100;
  }
  throw new Error("Question did not start");
}

it.each(["self", "auto"] as const)("caps a past recording at the instant it left the screen (%s)", async pacing => {
  const asset = await app.services.assets.save(owner.user.id, {
    body: wavSeconds(60), source: "upload", name: "Запись",
  });
  const { seat, wait } = await start([
    { type: "audio", asset: asset.id, durationSeconds: 2, replays: 0 },
    { type: "text", text: "Следующий блок", durationSeconds: 10 },
  ], pacing);
  now += pacing === "self" ? 500 : 2000;
  let event = await wait();
  if (pacing === "self") {
    await json("agent_act", { ...seat, cursor: event.cursor, action: { type: "next-block" } });
    event = await wait();
  }
  expect(event.state.game.blockIndex).toBe(1);
  now += 5000;
  const beyond = await call("agent_media", { ...seat, assetId: asset.id, offsetSeconds: pacing === "self" ? 1 : 3, seconds: 0.1 });
  expect(beyond.isError).toBe(true);
  expect(beyond.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("forbidden") });
  const heard = await call("agent_media", { ...seat, assetId: asset.id, offsetSeconds: 0.1, seconds: 0.2 });
  expect(heard.content[0]).toMatchObject({ type: "audio", mimeType: "audio/mpeg", data: expect.any(String) });
  expect((await wait()).state.game.blocks[0].playerElapsedSeconds).toBe(pacing === "self" ? 0.5 : 2);
});

async function animation(format: "webp" | "gif") {
  const side = 16;
  const frames = Buffer.concat([
    Buffer.alloc(side * side * 3, Buffer.from([255, 0, 0])),
    Buffer.alloc(side * side * 3, Buffer.from([0, 0, 255])),
  ]);
  const anim = sharp(frames, { raw: { width: side, height: side * 2, channels: 3, pageHeight: side } });
  return format === "webp"
    ? await anim.webp({ lossless: true, delay: [400, 400] }).toBuffer()
    : await anim.gif({ delay: [400, 400] }).toBuffer();
}

it.each(["webp", "gif"] as const)("decodes and masks the visible animation frame (%s)", async format => {
  const side = 16;
  const body = await animation(format);
  const asset = await app.services.assets.save(owner.user.id, { body, source: "upload", name: "Кадры" });
  const { seat } = await start([{ type: "image", asset: asset.id, effect: "spotlight", effectSeconds: 6, durationSeconds: 5 }], "auto");
  const pixels = async () => {
    const out = await call("agent_media", { ...seat, assetId: asset.id });
    if (out.content[0]?.type !== "image") throw new Error(JSON.stringify(out.content));
    const frame = await sharp(Buffer.from(out.content[0].data, "base64")).ensureAlpha().raw().toBuffer();
    const center = 4 * (8 * side + 5);
    expect(frame[3]).toBe(0);
    return Array.from(frame.subarray(center, center + 4));
  };
  expect(await pixels()).toEqual([255, 0, 0, 255]);
  now += 500;
  expect(await pixels()).toEqual([0, 0, 255, 255]);
});

it("renders an unmasked solid WebP with its original pixels", async () => {
  const body = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#f00" } }).webp({ lossless: true }).toBuffer();
  const asset = await app.services.assets.save(owner.user.id, { body, source: "upload", name: "Красное" });
  const { seat } = await start([{ type: "image", asset: asset.id, durationSeconds: 2 }], "auto");
  const out = await call("agent_media", { ...seat, assetId: asset.id });
  const image = out.content[0];
  if (image?.type !== "image") throw new Error(JSON.stringify(out.content));
  const pixels = await sharp(Buffer.from(image.data, "base64")).ensureAlpha().raw().toBuffer();
  expect(pixels).toEqual(Buffer.alloc(16 * 16 * 4, Buffer.from([255, 0, 0, 255])));
});

it("uses the round clock for Quizor backgrounds and the relevant phase clock for Yomifuda cards", async () => {
  const asset = await app.services.assets.save(owner.user.id, { body: await animation("gif"), source: "upload", name: "Фон" });
  const { seat } = await start([{ type: "pause", durationSeconds: 5 }], "auto", asset.id);
  const pixel = async () => {
    const out = await call("agent_media", { ...seat, assetId: asset.id });
    if (out.content[0]?.type !== "image") throw new Error(JSON.stringify(out.content));
    const bytes = await sharp(Buffer.from(out.content[0].data, "base64")).ensureAlpha().raw().toBuffer();
    return Array.from(bytes.subarray(0, 4));
  };
  expect(await pixel()).toEqual([255, 0, 0, 255]);
  now += 500;
  expect(await pixel()).toEqual([0, 0, 255, 255]);
  const context = vi.spyOn(app.services.lobbies, "botMediaView");
  const card = { image: { asset: asset.id } };
  context.mockResolvedValue({ gameId: "yomifuda", now, view: { hand: [card], table: [], choiceStartedAt: now - 500 } });
  expect(await pixel()).toEqual([0, 0, 255, 255]);
  context.mockResolvedValue({ gameId: "yomifuda", now, view: {
    hand: [], table: [{ hidden: false, card }], choiceStartedAt: now - 500, revealStartedAt: now - 100,
  } });
  expect(await pixel()).toEqual([255, 0, 0, 255]);
});
