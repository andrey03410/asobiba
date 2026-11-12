import { isPlainObject } from "../jsonSchema";

export function QuizSummary({ rules }: { rules: unknown }) {
  if (!isPlainObject(rules)) return null;
  const rounds = Array.isArray(rules.rounds)
    ? rules.rounds.filter(isPlainObject)
    : [];
  const presenter =
    rules.presenter === "required"
      ? "Нужен ведущий"
      : rules.presenter === "optional"
        ? "Ведущий по желанию"
        : "Без ведущего";
  return (
    <div className="quiz-summary">
      <p>
        <strong>Quizor</strong> · {presenter}
      </p>
      <ol>
        {rounds.map((r, i) => (
          <li key={i}>
            <b>{typeof r.title === "string" ? r.title : `Раунд ${i + 1}`}</b> ·{" "}
            {r.format === "board" ? "Табло" : "Подряд"}
            {typeof r.questionCount === "number"
              ? ` · вопросов: ${r.questionCount}`
              : Array.isArray(r.questions)
                ? ` · вопросов: ${r.take ?? r.questions.length}`
                : ""}
          </li>
        ))}
      </ol>
      <p className="muted small">
        Вопросы и правила проверки собирает ваш агент. Здесь можно выбрать
        готовый квиз и пригласить друзей.
      </p>
    </div>
  );
}
