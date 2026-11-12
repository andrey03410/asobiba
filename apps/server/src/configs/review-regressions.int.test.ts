import { quizor, type QuizorRules, type QuizorVisual } from "@asobiba/game-quizor";
import { presetDocument, type ConfigDocument } from "@asobiba/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mp4, wavSeconds } from "../assets/media-fixtures";
import { PNG_1x1, createTestApp, resetDb, signUp, type TestApp } from "../test/helpers";
import { renderPreview } from "../preview/render";

let t: TestApp;
beforeEach(async () => { t = await createTestApp(); await resetDb(t.db); });
afterEach(async () => { vi.restoreAllMocks(); await t?.close(); });
const document = () => presetDocument(quizor, quizor.presets[0]) as ConfigDocument<QuizorRules, QuizorVisual>;

describe("round background disclosure", () => {
  it("serves the current round-only background to a player and spectator and embeds it in previews", async () => {
    const host = await signUp(t, "host"); const player = await signUp(t, "player"); const viewer = await signUp(t, "viewer");
    const current = await t.services.assets.save(host.user.id, { body: PNG_1x1, source: "upload" });
    const future = await t.services.assets.save(host.user.id, { body: PNG_1x1, source: "upload" });
    const config = document();
    config.rules.rounds[0].visual = { ...config.visual, background: { asset: current.id } };
    config.rules.rounds.push({ ...structuredClone(config.rules.rounds[0]), id: "future", visual: { ...config.visual, background: { asset: future.id } }, questions: [{ ...structuredClone(config.rules.rounds[0].questions[0]), id: "future-q" }] });
    const lobby = await t.services.lobbies.create(host.user, { name: "Round-only backdrop", config });
    await t.services.lobbies.join(player.user, lobby.id, "player");
    await t.services.lobbies.join(viewer.user, lobby.id, "spectator");
    await t.services.lobbies.start(host.user, lobby.id);
    for (const user of [player, viewer]) {
      expect((await t.app.inject({ url: current.url, headers: { cookie: user.cookie } })).statusCode).toBe(200);
      expect((await t.app.inject({ url: future.url, headers: { cookie: user.cookie } })).statusCode).toBe(403);
    }
    const thumbnails = vi.spyOn(t.services.assets, "previewDataUris");
    await renderPreview(t.services.assets, config, "start", 1, { kind: "question", id: config.rules.rounds[0].questions[0].id });
    expect(thumbnails).toHaveBeenCalledWith([current.id]);
  });
});

describe("frozen full-media timing", () => {
  it("normalizes owned WAV/video duration through groups, intro, questions and reveal before save/lobby", async () => {
    const host = await signUp(t, "host");
    const sound = await t.services.assets.save(host.user.id, { body: wavSeconds(60), source: "upload" });
    const video = await t.services.assets.save(host.user.id, { body: await readFile(join(import.meta.dirname, "../assets/fixtures/blank-2s.mp4")), source: "upload" });
    const config = document();
    config.rules.rounds[0].intro = [{ type: "group", blocks: [{ type: "audio", asset: sound.id, from: 10, speed: 2, repeat: 3 }] }];
    config.rules.rounds[0].questions[0].blocks = [{ type: "video", asset: video.id }, { type: "audio", asset: sound.id, durationSeconds: 7 }, { type: "audio", asset: sound.id, from: 2, to: 4 }];
    config.rules.rounds[0].questions[0].reveal = [{ type: "audio", asset: sound.id }];
    const saved = await t.services.configs.save(host.user.id, config);
    const normalized = saved.document as ConfigDocument<QuizorRules, QuizorVisual>;
    expect(normalized.rules.rounds[0].intro[0].blocks?.[0].durationSeconds).toBe(75);
    expect(normalized.rules.rounds[0].questions[0].blocks[0].durationSeconds).toBeCloseTo(2, 5);
    expect(normalized.rules.rounds[0].questions[0].blocks[1].durationSeconds).toBe(7);
    expect(normalized.rules.rounds[0].questions[0].blocks[2].durationSeconds).toBeUndefined();
    expect(normalized.rules.rounds[0].questions[0].reveal[0].durationSeconds).toBe(60);
    expect(config.rules.rounds[0].questions[0].blocks[0].durationSeconds).toBeUndefined();
    const lobby = await t.services.lobbies.create(host.user, { name: "Frozen timing", configId: saved.id });
    const frozen = await t.db.lobby.findUniqueOrThrow({ where: { id: lobby.id } });
    expect((frozen.config as unknown as ConfigDocument<QuizorRules>).rules.rounds[0].questions[0].blocks[0].durationSeconds).toBeCloseTo(2, 5);
  });

  it("requires explicit duration/to when a structurally identified video has no trustworthy duration", async () => {
    const host = await signUp(t, "host");
    const video = await t.services.assets.save(host.user.id, { body: mp4(), source: "upload" });
    const config = document(); config.rules.rounds[0].questions[0].blocks = [{ type: "video", asset: video.id }];
    const result = await t.services.configs.validate(host.user.id, config);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "media_duration", path: "rules.rounds[0].questions[0].blocks[0].durationSeconds", hint: expect.stringMatching(/durationSeconds.*to/) })]));
    config.rules.rounds[0].questions[0].blocks[0].durationSeconds = 2;
    expect((await t.services.configs.validate(host.user.id, config)).ok).toBe(true);
    delete config.rules.rounds[0].questions[0].blocks[0].durationSeconds;
    config.rules.rounds[0].questions[0].blocks[0].to = 2;
    expect((await t.services.configs.validate(host.user.id, config)).ok).toBe(true);
  });

  it("reads immutable duration only for the owning account and evicts it on removal", async () => {
    const host = await signUp(t, "host"); const viewer = await signUp(t, "viewer");
    const sound = await t.services.assets.save(host.user.id, { body: wavSeconds(2.5), source: "upload" });
    expect(await t.services.assets.durationSeconds(host.user.id, sound.id)).toBe(2.5);
    expect(await t.services.assets.durationSeconds(viewer.user.id, sound.id)).toBeNull();
    expect(await t.services.assets.durationSeconds(host.user.id, sound.id)).toBe(2.5);
    await t.services.assets.remove(host.user.id, sound.id);
    expect(await t.services.assets.durationSeconds(host.user.id, sound.id)).toBeNull();
  });

  it("charges metadata enrichment to the complete normalized JSON budget", async () => {
    const host = await signUp(t, "host");
    const sound = await t.services.assets.save(host.user.id, { body: wavSeconds(2.5), source: "upload" });
    const config = document(); const template = config.rules.rounds[0].questions[0];
    config.rules.rounds[0].questions = Array.from({ length: 100 }, (_, i) => ({ ...structuredClone(template), id: `q-${i}`, prompt: "", blocks: [{ type: "audio" as const, asset: sound.id }] }));
    config.rules = quizor.rulesSchema.parse(config.rules);
    for (const question of config.rules.rounds[0].questions) question.fields[0].notes = "";
    let remaining = 2 * 1024 * 1024 - 16 - Buffer.byteLength(JSON.stringify(config));
    for (const question of config.rules.rounds[0].questions) {
      const prompt = Math.min(remaining, 20000); question.prompt = "x".repeat(prompt); remaining -= prompt;
      const notes = Math.min(remaining, 20000); question.fields[0].notes = "x".repeat(notes); remaining -= notes;
    }
    expect(remaining).toBe(0);
    expect(Buffer.byteLength(JSON.stringify(config))).toBe(2 * 1024 * 1024 - 16);
    const result = await t.services.configs.validate(host.user.id, config);
    expect(result.ok).toBe(false); expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "config_limit", path: "" })]));
  });
});
