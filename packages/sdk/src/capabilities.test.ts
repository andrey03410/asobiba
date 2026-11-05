import { describe, expect, it } from "vitest";
import { createCatalog, validateConfig } from "./config";
import { describeGame, listGames } from "./capabilities";
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
});
