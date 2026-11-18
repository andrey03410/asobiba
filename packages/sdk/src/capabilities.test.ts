import { describe, expect, it } from "vitest";
import { catalog } from "../../../apps/server/src/games/catalog";
import { collectAssetRefs, createCatalog, describeGame, describeGameGuide, listGames, validateConfig } from "./index";
import { raceGame } from "./testing";

describe("describeGame", () => {
  it("gives a JSON Schema with descriptions and normalized presets", () => {
    const caps = describeGame(raceGame);
    const schema = caps.configSchema as { properties: Record<string, { description?: string; properties?: Record<string, { description?: string }> }> };
    expect(schema.properties.series?.properties?.rounds?.description).toContain("раундов");
    expect(schema.properties.timer?.description).toContain("Таймер");
    expect(caps.presetConfigs[0]?.config.rules).toEqual({ target: 10, players: 2 });
    expect(caps.sdkGuide).toContain("lobby_create");
    expect(validateConfig(createCatalog([raceGame]), caps.presetConfigs[0]?.config).ok).toBe(true);
  });

  it("lists games with presets", () => {
    expect(listGames(createCatalog([raceGame]))).toEqual([
      expect.objectContaining({ id: "race", kind: "turn", presets: [expect.objectContaining({ id: "default" })] }),
    ]);
  });

  it("describes creating a lobby before any optional library save", () => {
    expect(describeGame(raceGame).sdkGuide).toContain("config_preview → lobby_create");
  });
});

describe("describeGameGuide", () => {
  it.each(catalog.list().map((game) => [game.id, game] as const))(
    "offers a public, runnable example and shares its guide with game_capabilities for %s",
    (id, game) => {
      const guide = describeGameGuide(game);
      const capabilities = describeGame(game);

      expect(guide).toMatchObject({ id, title: game.title, info: capabilities.info, tuning: capabilities.tuning });
      expect(guide.tuning.length).toBeGreaterThan(0);
      expect(guide.promptExamples.length).toBeGreaterThan(0);
      for (const prompt of guide.promptExamples) expect(prompt.trim()).not.toBe("");
      expect(guide.promptExamples).toEqual(capabilities.promptExamples);

      const example = guide.exampleConfig;
      if (!example) throw new Error(`No example config for ${id}`);
      expect(capabilities.presetConfigs.map(({ config }) => config)).toContainEqual(example);
      expect(collectAssetRefs(example)).toEqual([]);
      expect(validateConfig(catalog, example, { videoSnapshots: {} })).toMatchObject({ ok: true });
    },
  );

  it("leaves the example empty when the game declares no demonstration preset", () => {
    expect(describeGameGuide(raceGame).exampleConfig).toBeNull();
  });
});
