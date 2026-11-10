import { presetDocument } from "@asobiba/sdk";
import { russkoePole, type PoleRules } from "@asobiba/game-russkoe-pole";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb, signUp, type TestApp } from "../test/helpers";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
});
afterEach(async () => {
  await t?.close();
});

describe("russkoe pole lobby", () => {
  it("shows the lobby without the answer and plays the real word", async () => {
    const ann = await signUp(t, "ann");
    const preset = russkoePole.presets.find((item) => item.id === "solo");
    const base = presetDocument(russkoePole, preset);
    const rules = base.rules as PoleRules;
    const config = {
      ...base,
      rules: {
        ...rules,
        players: { min: 1, max: 1 },
        words: { ...rules.words, source: "custom" as const, rounds: 1, custom: [{ question: "Кто мурлычет", answer: "КОТ" }] },
        super: { ...rules.super, enabled: false },
      },
    };
    const created = await t.app.inject({ method: "POST", url: "/api/lobbies", headers: { cookie: ann.cookie }, payload: { name: "Поле", config } });
    expect(created.statusCode).toBe(201);
    const lobby = created.json().lobby;
    expect(JSON.stringify(lobby.config)).not.toContain("КОТ");
    expect(lobby.config.rules.words.custom[0].answer).toBe("секрет");
    const started = await t.app.inject({ method: "POST", url: `/api/lobbies/${lobby.id}/start`, headers: { cookie: ann.cookie } });
    expect(started.statusCode).toBe(200);
    const summary = await t.services.lobbies.matchSummary(lobby.id);
    expect(summary?.phase).toBe("playing");
    const room = await (t.services.lobbies as unknown as { room(id: string): Promise<{ match: { view(seat: number): { game: { question: string; tiles: { ch: string }[] } } } }> }).room(lobby.id);
    const game = room.match.view(0).game;
    expect(game.question).toBe("Кто мурлычет");
    expect(game.tiles).toHaveLength(3);
    expect(JSON.stringify(game)).not.toContain("КОТ");
  });
});
