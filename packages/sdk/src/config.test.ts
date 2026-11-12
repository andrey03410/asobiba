import { describe, expect, it } from "vitest";
import { z } from "zod";
import { collectAssetRefs, createCatalog, presetDocument, validateConfig } from "./config";
import { type AnyGame, defineGame } from "./game";
import { assetRef, color } from "./schema";
import { raceGame } from "./testing";

const skinGame = defineGame({
  ...(raceGame as AnyGame),
  id: "skin",
  visualSchema: z
    .strictObject({
      tint: color().optional(),
      pieces: z.array(z.union([z.strictObject({ preset: z.enum(["dot"]) }), z.strictObject({ asset: assetRef() })])).max(4).default([]),
    })
    .prefault({}),
});

const catalog = createCatalog([raceGame, skinGame]);
const base = { sdk: 1, game: "race", gameVersion: 1 };

describe("validateConfig", () => {
  it("fills defaults for missing sections", () => {
    const res = validateConfig(catalog, base);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.rules).toEqual({ target: 10, players: 2 });
    expect(res.config.series).toEqual({ rounds: 1, firstPlayer: "rotate", stopWhenDecided: true });
    expect(res.config.timer).toEqual({ turnSeconds: 0, onTimeout: "random" });
    expect(res.config.title).toBe("Гонка до числа");
  });

  it("rejects an unknown game with the list of games", () => {
    const res = validateConfig(catalog, { ...base, game: "chess" });
    expect(res.ok).toBe(false);
    expect(res.issues[0]).toMatchObject({ path: "game", code: "unknown_game" });
    expect(res.issues[0]?.hint).toContain("race");
  });

  it("asks to re-read capabilities when the game version differs", () => {
    const res = validateConfig(catalog, { ...base, gameVersion: 0 });
    expect(res.ok).toBe(false);
    expect(res.issues[0]).toMatchObject({ path: "gameVersion", code: "game_version" });
    expect(res.issues[0]?.hint).toContain("game_capabilities");
  });

  it("reports paths, Russian messages and hints for schema errors", () => {
    const res = validateConfig(catalog, { ...base, rules: { target: 1000, typo: 1 }, series: { rounds: 0 } });
    expect(res.ok).toBe(false);
    const byPath = Object.fromEntries(res.issues.map((i) => [i.path, i]));
    expect(byPath["rules.target"]?.hint).toBe("Максимум: 100");
    expect(byPath["rules"]?.code).toBe("unrecognized_keys");
    expect(byPath["series.rounds"]?.message).toMatch(/[а-я]/);
  });

  it("rejects a timer shorter than 3 seconds", () => {
    const res = validateConfig(catalog, { ...base, timer: { turnSeconds: 2 } });
    expect(res.ok).toBe(false);
    expect(res.issues[0]?.path).toBe("timer.turnSeconds");
  });

  it("prefixes the game's cross-field issues with rules", () => {
    const res = validateConfig(catalog, { ...base, rules: { target: 2, players: 3 } });
    expect(res.ok).toBe(false);
    expect(res.issues[0]).toMatchObject({ path: "rules.target", code: "too_small" });
  });

  it("explains slot unions", () => {
    const res = validateConfig(catalog, { ...base, game: "skin", visual: { pieces: [{ asset: "nope" }] } });
    expect(res.ok).toBe(false);
    expect(res.issues[0]?.path).toMatch(/^visual\.pieces\[0\]/);
  });
});

describe("collectAssetRefs", () => {
  it("includes question media and answer option assets in rules", () => {
    expect(collectAssetRefs({ visual: {}, rules: { rounds: [{ questions: [{ blocks: [{ type: "audio", asset: "ast_audio12345" }], fields: [{ options: [{ asset: "ast_option1234" }] }] }] }] } })).toEqual([
      { path: "rules.rounds[0].questions[0].blocks[0].asset", assetId: "ast_audio12345" },
      { path: "rules.rounds[0].questions[0].fields[0].options[0].asset", assetId: "ast_option1234" },
    ]);
  });
  it("finds every asset reference with its path", () => {
    const res = validateConfig(catalog, {
      ...base,
      game: "skin",
      visual: { pieces: [{ preset: "dot" }, { asset: "ast_abcdefgh12" }] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(collectAssetRefs(res.config)).toEqual([{ path: "visual.pieces[1].asset", assetId: "ast_abcdefgh12" }]);
  });
});

describe("presetDocument", () => {
  it("builds a full valid document from a preset", () => {
    const doc = presetDocument(raceGame, raceGame.presets[0]);
    expect(validateConfig(catalog, doc).ok).toBe(true);
  });
});
