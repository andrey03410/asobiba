import { expect, it } from "vitest";
import { presetDocument } from "@asobiba/sdk";
import { quizor } from "../game";
import type { QuizorRules } from "../rules";
import { previewMatch, previewTarget } from "./index";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuizorBoard } from "./Board";
it("previews the sanitized lobby summary without starting a quiz from incomplete rules", () => {
  const config = presetDocument(quizor, quizor.presets[0]);
  const shown = {
    ...config,
    rules: quizor.presentRules!(config.rules as QuizorRules),
  };
  const view = previewMatch(shown, "start", 1);
  expect(view.phase).toBe("playing");
  expect(JSON.stringify(view.game)).not.toContain("Какая планета");
});
it("targets an authored question and rejects an unknown question", () => {
  const config = presetDocument(quizor, quizor.presets[0]);
  expect(
    (
      previewTarget(config, { kind: "question", id: "earth" }, 1).game as {
        prompt: string;
      }
    ).prompt,
  ).toContain("Какая планета");
  expect(() =>
    previewTarget(config, { kind: "question", id: "missing" }, 1),
  ).toThrow("не найден");
});
it("labels the real theme columns in a board preview", () => {
  const config = presetDocument(
    quizor,
    quizor.presets.find((p) => p.id === "board"),
  );
  const match = previewTarget(config, { kind: "round", id: "board-1" }, 1);
  const html = renderToStaticMarkup(
    createElement(QuizorBoard, {
      match,
      config,
      seat: null,
      assetUrl: () => "",
      staticRender: true,
    }),
  );
  expect(html).toContain("Мир");
  expect(html).toContain("Наука");
  expect(html).toContain("Искусство");
});
it("shows an image nested in a simultaneous block group", () => {
  const config = presetDocument(quizor, quizor.presets[0]);
  const rules = config.rules as QuizorRules;
  rules.rounds[0]!.questions[0]!.blocks = [
    { type: "group", blocks: [{ type: "image", asset: "ast_preview00" }] },
  ];
  const match = previewTarget(config, { kind: "question", id: "earth" }, 1);
  const html = renderToStaticMarkup(
    createElement(QuizorBoard, {
      match,
      config,
      seat: null,
      assetUrl: (id) => `/files/${id}`,
      staticRender: true,
    }),
  );
  expect(html).toContain("/files/ast_preview00");
});
