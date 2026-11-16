import { describe, expect, it } from "vitest";
import { ticTacToe } from "../../../games/tic-tac-toe/src/game";
import { russkoePole } from "../../../games/russkoe-pole/src/game";
import { quizor } from "../../../games/quizor/src/game";
import { jinchi } from "../../../games/jinchi/src/game";
import * as sdk from "./index";

const catalog = sdk.createCatalog([ticTacToe, russkoePole, quizor, jinchi]);

describe("game and match information", () => {
  it("keeps old documents without author information and validates its limits", () => {
    const input = { sdk: 1, game: "tic-tac-toe", gameVersion: 1 };
    const legacy = sdk.validateConfig(catalog, input);
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    expect(legacy.config).not.toHaveProperty("info");
    expect(sdk.validateConfig(catalog, { ...input, info: {} }).ok).toBe(true);
    expect(sdk.validateConfig(catalog, { ...input, info: { title: "а".repeat(80), text: "б".repeat(2000) } }).ok).toBe(true);
    for (const info of [{ title: "а".repeat(81) }, { text: "б".repeat(2001) }]) {
      const invalid = sdk.validateConfig(catalog, { ...input, info });
      expect(invalid.ok).toBe(false);
      expect(invalid.issues[0]?.path).toMatch(/^info\.(title|text)$/);
    }
  });

  it.each([ticTacToe, russkoePole, quizor, jinchi])("introduces $id before a config exists", (game) => {
    const caps = sdk.describeGame(game);
    expect(caps.info).toMatchObject({ goal: expect.any(String), turn: expect.any(String), example: expect.any(String) });
    expect(caps.tuning.length).toBeGreaterThanOrEqual(5);
    expect(caps.tuning.length).toBeLessThanOrEqual(7);
    for (const direction of caps.tuning) {
      expect(direction.paths.length).toBeGreaterThan(0);
      expect(direction.options.length).toBeGreaterThan(0);
      expect(direction.options.every((option) => option.label && option.consequence)).toBe(true);
    }
  });

  it("describes actual misere, gravity, directions and moves", () => {
    const config = sdk.presetDocument(ticTacToe);
    config.rules = { ...(config.rules as object), board: { width: 7, height: 6, blocked: [] }, win: { line: 4, mode: "most-lines", misere: true, directions: ["horizontal", "vertical"] }, placement: "gravity", turns: { movesPerTurn: 2, firstTurnMoves: 1 }, players: 3 };
    expect(typeof sdk.describeConfig).toBe("function");
    const summary = sdk.describeConfig(ticTacToe, config).summary;
    expect(summary.players).toEqual({ min: 3, max: 3 });
    const text = JSON.stringify(summary);
    expect(text).toContain("7×6");
    expect(text).toContain("меньше");
    expect(text).toContain("падает");
    expect(text).toContain("по 2");
    expect(text).toContain("диагонал");
  });

  it("summarizes pole probabilities without its words or future crossword", () => {
    const config = sdk.presetDocument(russkoePole);
    const rules = russkoePole.rulesSchema.parse({ words: { source: "custom", rounds: 1, custom: [{ question: "Не копировать вопрос", answer: "СЕКРЕТСЛОВО" }] }, wheel: [{ type: "points", value: 100 }, { type: "points", value: 100 }, { type: "bankrupt" }, { type: "plus" }], super: { source: "custom", puzzles: [{ words: [{ question: "Не копировать финал", answer: "ТАЙНА" }] }] } });
    config.rules = rules;
    const text = JSON.stringify(sdk.describeConfig(russkoePole, config).summary);
    expect(text).toContain("50");
    for (const secret of ["СЕКРЕТСЛОВО", "ТАЙНА", "Не копировать вопрос", "Не копировать финал"]) expect(text).not.toContain(secret);
  });

  it("includes effective quiz settings while keeping future content and criteria private", () => {
    const config = sdk.presetDocument(quizor);
    config.rules = quizor.rulesSchema.parse({ defaults: { mode: "secret", timers: { answerSeconds: 20 } }, rounds: [{ id: "r", title: "Раунд", settings: { judge: "self" }, questions: [{ id: "secret-id", prompt: "БУДУЩИЙВОПРОС", settings: { mode: "buzz", timers: { answerSeconds: 45 } }, fields: [{ id: "a", type: "text", answers: [{ text: "ТАЙНЫЙОТВЕТ", comment: "ЗАМЕТКАВЕДУЩЕГО" }] }], special: { type: "gift", topic: "СКРЫТЫЙСЮРПРИЗ" }, blocks: [{ type: "text", text: "НЕПОКАЗАННЫЙБЛОК" }] }] }] });
    const text = JSON.stringify(sdk.describeConfig(quizor, config).summary);
    expect(text).toContain("кнопк");
    expect(text).toContain("самопровер");
    expect(text).toContain("45");
    for (const secret of ["secret-id", "БУДУЩИЙВОПРОС", "ТАЙНЫЙОТВЕТ", "ЗАМЕТКАВЕДУЩЕГО", "СКРЫТЫЙСЮРПРИЗ", "НЕПОКАЗАННЫЙБЛОК"]) expect(text).not.toContain(secret);
  });
});
