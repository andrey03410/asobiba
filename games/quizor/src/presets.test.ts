import { describe, expect, it } from "vitest";
import {
  createCatalog,
  presetDocument,
  simulate,
  validateConfig,
} from "@asobiba/sdk";
import { quizor } from "./game";

describe("Quizor presets", () => {
  for (const preset of quizor.presets)
    it(`${preset.id} validates and completes`, () => {
      const config = presetDocument(quizor, preset);
      const checked = validateConfig(createCatalog([quizor]), config);
      expect(checked.issues.filter((i) => i.severity !== "warning")).toEqual(
        [],
      );
      const report = simulate(quizor, config, {
        rounds: 2,
        maxActions: 5000,
        seed: 8,
      });
      expect(
        report.issues.filter((i) =>
          ["stuck", "never-ends", "illegal-legal-action"].includes(i.code),
        ),
      ).toEqual([]);
      expect(report.finished).toBe(2);
    });
});
