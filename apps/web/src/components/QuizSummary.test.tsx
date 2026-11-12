import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QuizSummary } from "./QuizSummary";
it("summarizes the quiz without displaying questions or judging criteria", () => {
  const html = renderToStaticMarkup(
    <QuizSummary
      rules={{
        presenter: "optional",
        rounds: [
          {
            title: "Кино",
            format: "board",
            questions: [
              {
                prompt: "Секретный вопрос",
                fields: [{ answers: ["Тайный ответ"] }],
              },
            ],
          },
        ],
      }}
    />,
  );
  expect(html).toContain("Кино");
  expect(html).toContain("Табло");
  expect(html).not.toContain("Секретный вопрос");
  expect(html).not.toContain("Тайный ответ");
});
