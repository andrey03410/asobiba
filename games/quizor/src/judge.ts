import {
  resolveQuestion,
  type Answers,
  type AnswerValue,
  type Condition,
  type Field,
  type QuizorRules,
  type ResolvedField,
  type ResolvedQuestion,
  type Settings,
  type TextVariant,
} from "./rules";

export interface FieldGrade {
  fieldId: string;
  grade: string;
  label: string;
  points: number;
  correct: boolean;
  doubtful: boolean;
  explanation: string;
  distance?: number;
  fraction?: number;
}
export interface QuestionGrade {
  grade: string;
  label: string;
  points: number;
  correct: boolean;
  doubtful: boolean;
  fields: FieldGrade[];
  explanation: string;
}
const NUMBERS: Record<string, string> = {
  ноль: "0",
  один: "1",
  одна: "1",
  два: "2",
  две: "2",
  три: "3",
  четыре: "4",
  пять: "5",
  шесть: "6",
  семь: "7",
  восемь: "8",
  девять: "9",
  десять: "10",
  eleven: "11",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};
export function normalizeText(value: string, settings: Settings): string {
  if (settings.strictness === "literal") return value;
  let words = value
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/);
  if (settings.text.numbers) words = words.map((w) => NUMBERS[w] ?? w);
  if (!settings.text.wordOrder) words.sort();
  return words.join(" ");
}
/** Optimal string alignment distance, including adjacent transpositions. */
export function typoDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const rows = Array.from({ length: x.length + 1 }, () =>
    new Array<number>(y.length + 1).fill(0),
  );
  for (let i = 0; i <= x.length; i++) rows[i][0] = i;
  for (let j = 0; j <= y.length; j++) rows[0][j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1])
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  return rows[x.length][y.length];
}
function allowance(length: number, strictness: Settings["strictness"]): number {
  if (strictness === "literal" || strictness === "exact") return 0;
  if (strictness === "strict") return length >= 8 ? 1 : 0;
  const n = length <= 4 ? 0 : length <= 8 ? 1 : 2;
  return n + (strictness === "soft" ? 1 : 0);
}
export function matchesText(
  value: string,
  variant: TextVariant,
  inherited: Settings,
): { matches: boolean; doubtful: boolean } {
  const settings = {
    ...inherited,
    strictness: variant.strictness ?? inherited.strictness,
  };
  const a = normalizeText(value, settings);
  const b = normalizeText(variant.text, settings);
  if (a === b) return { matches: true, doubtful: false };
  if (settings.strictness === "literal")
    return { matches: false, doubtful: false };
  const left = a.split(" ");
  const right = b.split(" ");
  if (!variant.keywords && left.length !== right.length)
    return { matches: false, doubtful: false };
  let doubtful = false;
  const remaining = [...left];
  for (let i = 0; i < right.length; i++) {
    const word = right[i];
    const limit = allowance(word.length, settings.strictness);
    const index = variant.keywords
      ? remaining.findIndex((w) => typoDistance(w, word) <= limit)
      : i;
    const observed = variant.keywords ? remaining[index] : left[index];
    if (observed === undefined || index < 0)
      return { matches: false, doubtful: false };
    const distance = typoDistance(observed, word);
    if (distance > limit) return { matches: false, doubtful: false };
    doubtful ||= distance > 0 && distance === limit;
    if (variant.keywords) remaining.splice(index, 1);
  }
  return { matches: true, doubtful };
}
export function parseNumber(value: AnswerValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const compact = value.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(compact))
    return null;
  const n = Number(compact);
  return Number.isFinite(n) ? n : null;
}
function numberDistance(
  field: Extract<Field, { type: "number" }>,
  value: number,
): number {
  const target = field.target;
  return typeof target === "number"
    ? Math.abs(value - target)
    : value < target.min
      ? target.min - value
      : value > target.max
        ? value - target.max
        : 0;
}
function targetNumber(field: Extract<Field, { type: "number" }>): number {
  return typeof field.target === "number"
    ? field.target
    : (field.target.min + field.target.max) / 2;
}
function coordinate(
  value: AnswerValue | undefined,
): { x: number; y: number } | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number"
    ? (value as { x: number; y: number })
    : null;
}
function testCondition(
  condition: Condition,
  field: Extract<Field, { type: "number" | "point" }>,
  value: AnswerValue,
  peers: (AnswerValue | undefined)[],
): boolean {
  if (condition.type === "and" || condition.type === "or")
    return condition.type === "and"
      ? condition.conditions.every((c) => testCondition(c, field, value, peers))
      : condition.conditions.some((c) => testCondition(c, field, value, peers));
  const point = coordinate(value);
  const n = parseNumber(value);
  const dist =
    field.type === "point"
      ? point
        ? Math.hypot(point.x - field.target.x, point.y - field.target.y)
        : Infinity
      : n === null
        ? Infinity
        : numberDistance(field, n);
  if (!Number.isFinite(dist)) return false;
  if (condition.type === "exact") return n === condition.value;
  if (condition.type === "range")
    return n !== null && n >= condition.min && n <= condition.max;
  if (condition.type === "distance") {
    let d = dist;
    if (condition.unit === "percent" && field.type === "number") {
      const base = Math.abs(targetNumber(field));
      d = base === 0 ? (dist === 0 ? 0 : Infinity) : (dist / base) * 100;
    }
    return condition.op === "lte"
      ? d <= condition.value
      : condition.op === "lt"
        ? d < condition.value
        : condition.op === "gte"
          ? d >= condition.value
          : d > condition.value;
  }
  if (condition.type === "nearest") {
    const side = condition.side ?? "any";
    const eligible = (v: AnswerValue | undefined) => {
      if (field.type === "point") return coordinate(v) !== null;
      const x = parseNumber(v);
      return (
        x !== null &&
        (side === "any" ||
          (side === "under" &&
            x <=
              (typeof field.target === "number"
                ? field.target
                : field.target.max)) ||
          (side === "over" &&
            x >=
              (typeof field.target === "number"
                ? field.target
                : field.target.min)))
      );
    };
    if (!eligible(value)) return false;
    const distances = peers
      .filter(eligible)
      .map((v) =>
        field.type === "point"
          ? Math.hypot(
              coordinate(v)!.x - field.target.x,
              coordinate(v)!.y - field.target.y,
            )
          : numberDistance(field, parseNumber(v)!),
      );
    const rank = new Set(distances.filter((d) => d < dist)).size + 1;
    return rank === (condition.rank ?? 1);
  }
  return false;
}
export function gradePoints(
  settings: Settings,
  gradeId: string,
  value = settings.value,
): { grade: string; label: string; points: number; correct: boolean } {
  const grade =
    settings.grades.find((g) => g.id === gradeId) ??
    (gradeId === "correct"
      ? settings.grades.find((g) => g.correct)
      : gradeId === "partial"
        ? settings.grades.find(
            (g) => !g.correct && (g.points ?? (g.fraction ?? 0) * value) > 0,
          )
        : gradeId === "fail"
          ? settings.grades.find(
              (g) => (g.points ?? (g.fraction ?? 0) * value) < 0,
            )
          : settings.grades.find(
              (g) =>
                !g.correct && (g.points ?? (g.fraction ?? 0) * value) === 0,
            ));
  return {
    grade: grade?.id ?? gradeId,
    label: grade?.label ?? gradeId,
    points: grade?.points ?? Math.round((grade?.fraction ?? 0) * value),
    correct: grade?.correct ?? false,
  };
}
function blank(value: AnswerValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}
export function judgeField(
  resolved: ResolvedField,
  answer: AnswerValue | undefined,
  peers: (AnswerValue | undefined)[] = [],
): FieldGrade {
  const { field, settings } = resolved;
  const make = (
    grade: string,
    explanation: string,
    doubtful = false,
    fraction?: number,
  ): FieldGrade => {
    const g = gradePoints(settings, grade);
    return {
      fieldId: field.id,
      ...g,
      points:
        fraction === undefined
          ? g.points
          : Math.round(gradePoints(settings, "correct").points * fraction),
      correct: fraction === undefined ? g.correct : fraction === 1,
      doubtful,
      explanation,
      ...(fraction === undefined ? {} : { fraction }),
    };
  };
  if (blank(answer)) return make("silence", "Ответ не отправлен");
  if (field.type === "text") {
    if (typeof answer !== "string") return make("miss", "Ожидается текст");
    for (const variant of field.wrong) {
      const match = matchesText(answer, variant, settings);
      if (match.matches)
        return make(
          variant.grade,
          variant.comment ?? "Явно неверный ответ",
          match.doubtful,
        );
    }
    for (const variant of field.answers) {
      const match = matchesText(answer, variant, settings);
      if (match.matches)
        return make(
          variant.grade,
          variant.comment ??
            (match.doubtful
              ? "Ответ принят на границе допуска опечаток"
              : "Совпадение с эталоном"),
          match.doubtful ||
            !gradePoints(settings, variant.grade).correct ||
            field.wrong.some(
              (w) =>
                matchesText(answer, w, { ...settings, strictness: "soft" })
                  .matches,
            ),
        );
    }
    return make("miss", "Ответ не совпал с вариантами");
  }
  if (field.type === "number" || field.type === "point") {
    let distance: number;
    if (field.type === "number") {
      const n = parseNumber(answer);
      if (
        n === null ||
        (field.min !== undefined && n < field.min) ||
        (field.max !== undefined && n > field.max)
      )
        return make("miss", "Некорректное число");
      distance = numberDistance(field, n);
    } else {
      const point = coordinate(answer);
      if (!point) return make("miss", "Ожидается точка");
      distance = Math.hypot(point.x - field.target.x, point.y - field.target.y);
      for (const zone of field.zones) {
        const hit =
          zone.type === "circle"
            ? Math.hypot(point.x - zone.x, point.y - zone.y) <= zone.radius
            : point.x >= zone.x &&
              point.x <= zone.x + zone.width &&
              point.y >= zone.y &&
              point.y <= zone.y + zone.height;
        if (hit)
          return { ...make(zone.grade, "Точка в заданной зоне"), distance };
      }
    }
    const step = field.steps.find((s) =>
      testCondition(s.condition, field, answer!, peers),
    );
    return {
      ...make(
        step?.grade ??
          (field.steps.length === 0 && distance === 0 ? "correct" : "miss"),
        step
          ? "Подошла ступень проверки"
          : field.steps.length === 0 && distance === 0
            ? field.type === "number" && typeof field.target !== "number"
              ? "Ответ в верном диапазоне"
              : "Совпадение с эталоном"
            : "Ни одна ступень не подошла",
      ),
      distance,
    };
  }
  if (settings.judge === "poll" && (field.type === "choice" || field.type === "order")) {
    const result = pollResult(field, peers);
    const voted = (grade: FieldGrade): FieldGrade => ({ ...grade, label: "Голос учтён" });
    if (field.type === "choice") {
      if (!field.options.some((o) => o.id === answer)) return make("miss", "Некорректный вариант");
      if (settings.poll.scoring === "none") return voted(make("miss", "Мнение без очков", false, 0));
      const top = Math.max(...Object.values(result.votes));
      return result.votes[answer as string] === top
        ? make("correct", "Выбор большинства")
        : make("miss", "Большинство выбрало другое");
    }
    if (
      !Array.isArray(answer) ||
      answer.length !== field.items.length ||
      new Set(answer).size !== answer.length ||
      answer.some((a) => !field.items.some((i) => i.id === a))
    )
      return make("miss", "Некорректный порядок");
    if (settings.poll.scoring === "none") return voted(make("miss", "Мнение без очков", false, 0));
    if (settings.poll.scoring === "majority")
      return answer[0] === result.ranking[0]
        ? make("correct", "Первое место совпало с общим")
        : make("miss", "Общий топ начинается с другого");
    const good = answer.filter((a, i) => a === result.ranking[i]).length;
    const exact = good === answer.length;
    return make(
      exact ? "correct" : good > 0 ? "partial" : "miss",
      "Совпадение с общим топом по местам",
      false,
      good / answer.length,
    );
  }
  if (field.type === "choice")
    return make(
      field.options.find((o) => o.id === answer)?.grade ?? "miss",
      "Оценка выбранного варианта",
    );
  if (field.type === "multi") {
    if (
      !Array.isArray(answer) ||
      new Set(answer).size !== answer.length ||
      answer.some((a) => !field.options.some((o) => o.id === a)) ||
      (field.maxSelected !== undefined && answer.length > field.maxSelected)
    )
      return make("miss", "Некорректный набор вариантов");
    const correct = field.options.filter((o) => o.correct).map((o) => o.id);
    const good = answer.filter((a) => correct.includes(a)).length;
    const wrong = answer.length - good;
    if (field.scoring === "all")
      return make(
        good === correct.length && wrong === 0 ? "correct" : "miss",
        "Полное совпадение набора",
      );
    if (field.scoring === "threshold")
      return make(
        good >= field.threshold && wrong === 0 ? "correct" : "miss",
        "Порог правильных вариантов",
      );
    return make(
      good === correct.length && wrong === 0
        ? "correct"
        : good > wrong
          ? "partial"
          : "miss",
      "Верные варианты минус неверные",
      false,
      (good - wrong) / Math.max(1, correct.length),
    );
  }
  if (field.type === "order") {
    if (
      !Array.isArray(answer) ||
      answer.length !== field.correct.length ||
      new Set(answer).size !== answer.length ||
      answer.some((a) => !field.correct.includes(a))
    )
      return make("miss", "Некорректный порядок");
    const exact = answer.every((a, i) => a === field.correct[i]);
    if (field.scoring === "all")
      return make(exact ? "correct" : "miss", "Полный порядок");
    let good = 0;
    let total = field.correct.length;
    if (field.scoring === "position")
      good = answer.filter((a, i) => a === field.correct[i]).length;
    else {
      total = (field.correct.length * (field.correct.length - 1)) / 2;
      for (let i = 0; i < answer.length; i++)
        for (let j = i + 1; j < answer.length; j++)
          if (
            field.correct.indexOf(answer[i]) < field.correct.indexOf(answer[j])
          )
            good++;
    }
    return make(
      exact ? "correct" : good > 0 ? "partial" : "miss",
      "Доля верных позиций или пар",
      false,
      good / total,
    );
  }
  if (field.type === "match") {
    if (
      !answer ||
      typeof answer !== "object" ||
      Array.isArray(answer) ||
      coordinate(answer)
    )
      return make("miss", "Ожидаются соответствия");
    const good = field.left.filter(
      (i) => (answer as Record<string, string>)[i.id] === field.correct[i.id],
    ).length;
    if (field.scoring === "all")
      return make(
        good === field.left.length ? "correct" : "miss",
        "Полное соответствие",
      );
    if (field.scoring === "threshold")
      return make(
        good >= field.threshold ? "correct" : "miss",
        "Порог верных пар",
      );
    return make(
      good === field.left.length ? "correct" : good > 0 ? "partial" : "miss",
      "Доля верных пар",
      false,
      good / field.left.length,
    );
  }
  if (field.type === "list") {
    if (!Array.isArray(answer) || answer.length > field.maxItems)
      return make("miss", "Ожидается список");
    const matched = new Set<number>();
    let doubtful = false;
    for (const item of answer) {
      const index = field.items.findIndex(
        (i, index) =>
          !matched.has(index) &&
          i.answers.some((v) => matchesText(item, v, settings).matches),
      );
      if (index >= 0) {
        matched.add(index);
        doubtful ||= field.items[index].answers.some(
          (v) => matchesText(item, v, settings).doubtful,
        );
      }
    }
    const fraction =
      Math.min(matched.size, field.maxItems) /
      Math.min(field.items.length, field.maxItems);
    return make(
      fraction === 1 ? "correct" : fraction > 0 ? "partial" : "miss",
      `Засчитано ${matched.size} разных элементов`,
      doubtful,
      fraction,
    );
  }
  return make("miss", "Ответ оценивает человек");
}
export interface PollResult {
  /** Choice: players per option. Order: Borda points (place i of N gives N − i). */
  votes: Record<string, number>;
  /** Options from the most to the least popular; ties by first places, then by authored order. */
  ranking: string[];
  /** Choice: seats per option are added by the game, which knows the seats. */
}

/** The shared opinion of all answers to a poll field. */
export function pollResult(
  field: Extract<Field, { type: "choice" | "order" }>,
  answers: (AnswerValue | undefined)[],
): PollResult {
  const ids = field.type === "choice" ? field.options.map((o) => o.id) : field.items.map((i) => i.id);
  const votes: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const firsts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const answer of answers) {
    if (field.type === "choice") {
      if (typeof answer === "string" && answer in votes) {
        votes[answer]++;
        firsts[answer]++;
      }
    } else if (Array.isArray(answer) && answer.length === ids.length && new Set(answer).size === ids.length && answer.every((a) => typeof a === "string" && a in votes)) {
      (answer as string[]).forEach((id, place) => (votes[id] += ids.length - place));
      firsts[answer[0] as string]++;
    }
  }
  const ranking = [...ids].sort((a, b) => votes[b] - votes[a] || firsts[b] - firsts[a] || ids.indexOf(a) - ids.indexOf(b));
  return { votes, ranking };
}

export function judgeQuestion(
  question: ResolvedQuestion,
  answers: Answers,
  peers: Answers[] = [],
): QuestionGrade {
  const fields = question.fields.map((field) =>
    judgeField(
      field,
      answers[field.field.id],
      peers.map((a) => a[field.field.id]),
    ),
  );
  const required = fields.filter((_, i) => question.fields[i].field.required);
  const correct =
    fields.some((f) => f.correct) && required.every((f) => f.correct);
  const count = fields.filter((f) => f.correct).length;
  const combined =
    question.settings.combine === "count"
      ? gradePoints(
          question.settings,
          question.settings.countGrades[String(count)] ??
            (correct ? "correct" : count ? "partial" : "miss"),
        )
      : question.settings.combine === "all"
        ? gradePoints(question.settings, correct ? "correct" : "miss")
        : null;
  const points =
    combined?.points ?? fields.reduce((sum, f) => sum + f.points, 0);
  const grade =
    combined?.grade ??
    (correct
      ? "correct"
      : fields.find((f) => f.grade === "fail")
        ? "fail"
        : points > 0
          ? "partial"
          : fields.every((f) => f.grade === "silence")
            ? "silence"
            : "miss");
  // Poll without scoring: an opinion is neither right nor wrong.
  const opinion = fields.length > 0 && fields.every((f) => f.label === "Голос учтён");
  return {
    grade: gradePoints(question.settings, grade).grade,
    label: opinion ? "Голос учтён" : (combined?.label ?? gradePoints(question.settings, grade).label),
    points,
    correct: combined?.correct ?? correct,
    doubtful: fields.some((f) => f.doubtful),
    fields,
    explanation: fields.map((f) => `${f.fieldId}: ${f.explanation}`).join("; "),
  };
}
export function probeQuestion(
  rules: QuizorRules,
  questionId: string,
  answers: Answers[],
): QuestionGrade[] {
  const question = resolveQuestion(rules, questionId);
  return answers.map((answer) => judgeQuestion(question, answer, answers));
}
