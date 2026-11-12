import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerForm, initialAnswers, answerInputError } from "./AnswerForm";

describe("Quizor answer form", () => {
  it("accepts a comma and grouped digits but rejects a nonnumeric number answer", () => {
    const fields = [
      { id: "n", type: "number", label: "Число", min: -2000, max: 2000 },
    ];
    expect(answerInputError(fields, { n: "-1 200,5" })).toBeNull();
    expect(answerInputError(fields, { n: "0" })).toBeNull();
    expect(answerInputError(fields, { n: "кот" })).toContain("число");
    expect(answerInputError(fields, { n: "2001" })).toContain("диапазон");
  });
  it("uses the visible initial slider value as the submitted answer", () => {
    expect(
      initialAnswers([
        { id: "n", type: "number", input: "slider", min: 100, max: 200 },
      ]),
    ).toEqual({ n: 100 });
  });
  it("offers all field formats with labels and no author criteria", () => {
    const fields = [
      { id: "text", type: "text", label: "Исполнитель" },
      { id: "number", type: "number", label: "Год", unit: "год" },
      {
        id: "choice",
        type: "choice",
        label: "Вариант",
        options: [{ id: "a", text: "А" }],
      },
      {
        id: "multi",
        type: "multi",
        label: "Несколько",
        options: [{ id: "a", text: "Б" }],
      },
      {
        id: "order",
        type: "order",
        label: "Порядок",
        items: [
          { id: "a", text: "Первый" },
          { id: "b", text: "Второй" },
        ],
      },
      {
        id: "match",
        type: "match",
        label: "Соответствие",
        left: [{ id: "a", text: "Слева" }],
        right: [{ id: "b", text: "Справа" }],
      },
      { id: "list", type: "list", label: "Перечисление", maxItems: 3 },
      { id: "point", type: "point", label: "Место", asset: "ast_public00" },
      { id: "oral", type: "oral", label: "Устно" },
    ];
    const html = renderToStaticMarkup(
      <AnswerForm
        fields={fields}
        value={initialAnswers(fields)}
        onChange={() => {}}
        onSubmit={() => {}}
        assetUrl={(id) => `/files/${id}`}
      />,
    );
    for (const label of [
      "Исполнитель",
      "Год",
      "Вариант",
      "Несколько",
      "Порядок",
      "Соответствие",
      "Перечисление",
      "Место",
      "Устно",
    ])
      expect(html).toContain(label);
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain("Поднять");
    expect(html).toContain("Справа");
    expect(html).toContain("Ответить");
    expect(html).not.toContain("correct");
  });
  it("initializes order and matching without exposing a solution", () => {
    expect(
      initialAnswers([
        {
          id: "o",
          type: "order",
          items: [
            { id: "b", text: "Б" },
            { id: "a", text: "А" },
          ],
        },
        { id: "m", type: "match" },
      ]),
    ).toEqual({ o: ["b", "a"], m: {} });
  });
});
