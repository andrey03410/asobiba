import { quizor, type QuizorRules, type QuizorVisual } from "@asobiba/game-quizor";
import { createCatalog, presetDocument, type ConfigDocument } from "@asobiba/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wav, mp4 } from "../assets/media-fixtures";
import { createTestApp, PNG_1x1, resetDb, signUp, type TestApp } from "../test/helpers";
import { ConfigService } from "./service";

let t: TestApp;
let configs: ConfigService;
let ownerId: string;
let image: string;
let audio: string;
let video: string;
type QuizConfig = ConfigDocument<QuizorRules, QuizorVisual>;
const document = () => presetDocument(quizor, quizor.presets[0]) as QuizConfig;
beforeEach(async () => {
  t = await createTestApp(); await resetDb(t.db);
  configs = new ConfigService(t.db, createCatalog([quizor]), t.services.assets);
  ownerId = (await signUp(t, "owner")).user.id;
  image = (await t.services.assets.save(ownerId, { body: PNG_1x1, source: "upload" })).id;
  audio = (await t.services.assets.save(ownerId, { body: wav(), source: "upload" })).id;
  video = (await t.services.assets.save(ownerId, { body: mp4(), source: "upload" })).id;
});
afterEach(async () => { await t?.close(); });

describe("Quizor media validation", () => {
  it.each([
    ["audio", "image"], ["video", "audio"], ["image", "video"],
  ] as const)("rejects a %s block containing %s at its exact asset path", async (type, source) => {
    const config = document();
    config.rules.rounds[0].questions[0].blocks = [{ type, asset: { image, audio, video }[source] }];
    const result = await configs.validate(ownerId, config);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "asset_mime", path: "rules.rounds[0].questions[0].blocks[0].asset", severity: "error" })]));
  });

  it("checks nested intro/reveal media, point fields and visual backgrounds", async () => {
    const config = document();
    config.rules.rounds[0].intro = [{ type: "group", blocks: [{ type: "audio", asset: image }] }];
    config.rules.rounds[0].questions[0].reveal = [{ type: "video", asset: audio }];
    config.rules.rounds[0].questions[0].fields = [{ id: "map", label: "Карта", required: true, type: "point", asset: audio, target: { x: 0.5, y: 0.5 }, steps: [], zones: [] }];
    config.visual.background = { asset: video };
    const result = await configs.validate(ownerId, config);
    expect(result.ok).toBe(false);
    expect(result.issues.filter(i => i.code === "asset_mime").map(i => i.path)).toEqual(expect.arrayContaining([
      "rules.rounds[0].intro[0].blocks[0].asset", "rules.rounds[0].questions[0].reveal[0].asset", "rules.rounds[0].questions[0].fields[0].asset", "visual.background.asset",
    ]));
  });

  it("uses image by default for options/items and honors media:audio", async () => {
    const config = document();
    config.rules.rounds[0].questions[0].fields = [
      { id: "choice", label: "Выбор", required: true, type: "choice", options: [{ id: "a", text: "A", asset: audio, grade: "correct" }, { id: "b", text: "B", asset: image, media: "audio", grade: "miss" }] },
      { id: "order", label: "Порядок", required: true, type: "order", items: [{ id: "a", text: "A", asset: audio }, { id: "b", text: "B", asset: image, media: "audio" }], correct: ["a", "b"], scoring: "all" },
    ];
    const result = await configs.validate(ownerId, config);
    expect(result.ok).toBe(false);
    expect(result.issues.filter(i => i.code === "asset_mime").map(i => i.path)).toEqual(expect.arrayContaining([
      "rules.rounds[0].questions[0].fields[0].options[0].asset", "rules.rounds[0].questions[0].fields[0].options[1].asset", "rules.rounds[0].questions[0].fields[1].items[0].asset", "rules.rounds[0].questions[0].fields[1].items[1].asset",
    ]));
  });

  it("accepts matching containers and counts repeated references once", async () => {
    const config = document();
    config.rules.rounds[0].questions[0].blocks = [{ type: "audio", asset: audio }, { type: "video", asset: video }, { type: "image", asset: image }, { type: "audio", asset: audio }];
    config.visual.background = { asset: image };
    await t.db.asset.update({ where: { id: audio }, data: { bytes: 900 * 1024 * 1024 } });
    expect((await configs.validate(ownerId, config)).ok).toBe(true);
    await t.db.asset.update({ where: { id: video }, data: { bytes: 200 * 1024 * 1024 } });
    expect((await configs.validate(ownerId, config)).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "media_quota" })]));
  });

  it("rejects a missing well-formed asset id rather than accepting its MIME", async () => {
    const config = document(); config.rules.rounds[0].questions[0].blocks = [{ type: "audio", asset: "ast_missing000000" }];
    const result = await configs.validate(ownerId, config);
    expect(result.ok).toBe(false); expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "asset_not_found" })]));
  });

  it("bounds the complete direct-call JSON, including title, in UTF-8 bytes", async () => {
    for (const input of [{ ...document(), title: "я".repeat(1_050_000) }, { ...document(), unused: "x".repeat(2 * 1024 * 1024) }]) {
      const result = await configs.validate(ownerId, input);
      expect(result.ok).toBe(false);
      expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "config_limit", path: "" })]));
    }
  });
});
