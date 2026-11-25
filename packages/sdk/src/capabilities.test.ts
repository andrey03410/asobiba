import { describe, expect, it } from "vitest";
import { catalog } from "../../../apps/server/src/games/catalog";
import { Match, presetDocument, collectAssetRefs, createCatalog, describeGame, describeGameGuide, listGames, validateConfig } from "./index";
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

describe("AI seat contract", () => {
  it.each(catalog.list())("publishes safe player guidance for $id", (game) => {
    expect(describeGameGuide(game).player).toMatchObject({role: "player", example: expect.any(String)});
    expect(describeGame(game).player).toEqual(describeGameGuide(game).player);
    expect(typeof game.playerActions).toBe("function");
  });

  it.each(catalog.list())("makes an actionable decision reachable in the demo of $id", (game) => {
    const preset = game.presets.find(p => p.id === game.examplePresetId);
    const config = presetDocument(game, preset);
    const seats = game.seats(config.rules).min;
    const match = Match.start({ game, config, seats, seed: 117, startedAt: 1000 });
    for (let i = 0; i < 100; i++) {
      for (let seat = 0; seat < seats; seat++) {
        const state = match.view(seat);
        if (game.kind === "turn" && !state.currentSeats.includes(seat)) continue;
        const visible = game.playerView?.(state.game, seat, match.checkpointAt) ?? state.game;
        if (game.playerActions(visible, seat).length > 0) return;
      }
      const at = match.nextWakeAt();
      if (at === null) break;
      match.advance(at);
    }
    throw new Error(`No player decision in the ${game.id} demo`);
  });

  it("rejects a game without seat input forms at catalog registration", () => {
    expect(() => createCatalog([{ ...raceGame, playerActions: undefined } as unknown as typeof raceGame])).toThrow(/playerActions/);
  });
});
