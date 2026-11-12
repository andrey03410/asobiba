import { describe, expect, it } from "vitest";
import { probeQuestion } from "./judge";
import { rulesSchema } from "./rules";

const rulesFor = (field: unknown, settings = {}) =>
  rulesSchema.parse({
    defaults: settings,
    rounds: [
      {
        id: "r",
        questions: [{ id: "q", prompt: "Проверка", fields: [field] }],
      },
    ],
  });
describe("Quizor judges", () => {
  it.each([100, { min: 90, max: 110 }])(
    "explains an implicit numeric target %j as a successful match",
    (target) => {
      const result = probeQuestion(
        rulesFor({ id: "a", type: "number", target }),
        "q",
        [{ a: 100 }],
      )[0];
      expect(result).toMatchObject({ correct: true, points: 100 });
      expect(result.fields[0].explanation).toMatch(/эталон|диапазон/);
      expect(result.fields[0].explanation).not.toMatch(/не подошла/);
    },
  );
  it("defaults an explicitly wrong text variant to a negative grade", () => {
    const rules = rulesFor({
      id: "a",
      type: "text",
      answers: [{ text: "Австралия" }],
      wrong: [{ text: "Австрия" }],
    });
    expect(probeQuestion(rules, "q", [{ a: "Австрия" }])[0]).toMatchObject({
      correct: false,
      points: -50,
    });
  });
  it("normalizes text, tolerates transposition and gives explicit wrong answers priority", () => {
    const rules = rulesFor({
      id: "a",
      type: "text",
      answers: [{ text: "Австралия" }],
      wrong: [{ text: "Австрия", grade: "fail" }],
    });
    expect(
      probeQuestion(rules, "q", [
        { a: "АВСТРАЛИЯ!" },
        { a: "Австаралия" },
        { a: "Австрия" },
      ]).map((x) => x.grade),
    ).toEqual(["correct", "correct", "fail"]);
  });
  it("uses numeric nearest ties and ordered conditions", () => {
    const rules = rulesFor({
      id: "a",
      type: "number",
      target: 100,
      steps: [
        {
          condition: { type: "nearest", rank: 1, side: "under" },
          grade: "correct",
        },
        { condition: { type: "distance", op: "gt", value: 50 }, grade: "fail" },
      ],
    });
    expect(
      probeQuestion(rules, "q", [
        { a: "90" },
        { a: "110" },
        { a: "90" },
        { a: "1 000,0" },
      ]).map((x) => x.points),
    ).toEqual([100, 0, 100, -50]);
  });
  it.each([
    [
      {
        id: "a",
        type: "choice",
        options: [
          { id: "x", text: "X", grade: "correct" },
          { id: "y", text: "Y" },
        ],
      },
      "x",
      100,
    ],
    [
      {
        id: "a",
        type: "multi",
        options: [
          { id: "x", text: "X", correct: true },
          { id: "y", text: "Y", correct: false },
        ],
        scoring: "per-item",
      },
      ["x", "y"],
      0,
    ],
    [
      {
        id: "a",
        type: "order",
        items: [
          { id: "x", text: "X" },
          { id: "y", text: "Y" },
        ],
        correct: ["y", "x"],
      },
      ["y", "x"],
      100,
    ],
    [
      {
        id: "a",
        type: "match",
        left: [{ id: "x", text: "X" }],
        right: [{ id: "y", text: "Y" }],
        correct: { x: "y" },
      },
      { x: "y" },
      100,
    ],
    [
      {
        id: "a",
        type: "list",
        items: [{ answers: [{ text: "А" }] }, { answers: [{ text: "Б" }] }],
      },
      ["а", "А", "Б"],
      100,
    ],
    [
      {
        id: "a",
        type: "point",
        asset: "ast_test000000",
        target: { x: 0.5, y: 0.5 },
        steps: [
          {
            condition: { type: "distance", op: "lte", value: 0.1 },
            grade: "correct",
          },
        ],
      },
      { x: 0.5, y: 0.5 },
      100,
    ],
  ])("grades the field %j", (field, answer, points) => {
    expect(probeQuestion(rulesFor(field), "q", [{ a: answer }])[0].points).toBe(
      points,
    );
  });
  it("combines partial fields using a count table", () => {
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Два",
              settings: {
                combine: "count",
                countGrades: { "0": "miss", "1": "partial", "2": "correct" },
              },
              fields: [
                { id: "a", type: "text", answers: [{ text: "a" }] },
                { id: "b", type: "text", answers: [{ text: "b" }] },
              ],
            },
          ],
        },
      ],
    });
    expect(probeQuestion(rules, "q", [{ a: "a", b: "no" }])[0].points).toBe(50);
  });
  it("uses custom correct/partial grade identities for structural fields", () => {
    const rules = rulesFor(
      {
        id: "a",
        type: "order",
        items: [
          { id: "x", text: "X" },
          { id: "y", text: "Y" },
        ],
        correct: ["y", "x"],
      },
      {
        grades: [
          { id: "yes", label: "Верно", fraction: 1, correct: true },
          { id: "almost", label: "Почти", fraction: 0.5 },
          { id: "no", label: "Нет", fraction: 0 },
        ],
      },
    );
    expect(probeQuestion(rules, "q", [{ a: ["y", "x"] }])[0]).toMatchObject({
      grade: "yes",
      label: "Верно",
      points: 100,
      correct: true,
    });
  });
});
