import type { PlayerHandles } from "@asobiba/sdk";
import type { PublicAnswer, PublicField, QuizorView } from "./game";
import type { Answers, AnswerValue } from "./rules";

const fieldScope = (question: string) => JSON.stringify(["field", question]);
const valueScope = (question: string, field: string, list: string) => JSON.stringify(["value", question, field, list]);
type Transform = (scope: string, value: unknown, allowed: readonly string[]) => string | undefined;

function fieldView(field: PublicField, question: string, ids: PlayerHandles): PublicField {
  const id = ids.issue(fieldScope(question), field.id);
  const encode = <T extends { id: string }>(items: T[], list: string) => items.map(item =>
    ({ ...item, id: ids.issue(valueScope(question, field.id, list), item.id) }));
  const options = field.options && encode(field.options, "options");
  return { ...field, id,
    ...(options && { options: field.pick === "frame" ? options.map(o => ({id: o.id, card: o.card, text: ""})) : options }),
    ...(field.items && {items: encode(field.items, "items")}),
    ...(field.left && {left: encode(field.left, "left")}),
    ...(field.right && {right: encode(field.right, "right")}),
  };
}

function transformValue(field: PublicField, question: string, value: AnswerValue, transform: Transform): AnswerValue | undefined {
  const one = (list: "options" | "items" | "left" | "right", v: unknown) =>
    transform(valueScope(question, field.id, list), v, (field[list] ?? []).map(i => i.id));
  if (value === null) return null;
  switch (field.type) {
    case "choice": return one("options", value);
    case "order":
    case "multi": {
      if (!Array.isArray(value)) return;
      const result: string[] = [];
      for (const entry of value) {
        const id = one(field.type === "order" ? "items" : "options", entry);
        if (id === undefined) return;
        result.push(id);
      }
      return result;
    }
    case "match": {
      if (typeof value !== "object" || Array.isArray(value)) return;
      const pairs: [string, string][] = [];
      for (const [left, right] of Object.entries(value)) {
        const a = one("left", left), b = one("right", right);
        if (a === undefined || b === undefined) return;
        pairs.push([a, b]);
      }
      return Object.fromEntries(pairs);
    }
    default: return value;
  }
}

function encodeAnswers(values: Answers, fields: PublicField[], question: string, ids: PlayerHandles): Answers {
  const encode: Transform = (scope, raw, allowed) => typeof raw === "string" && allowed.includes(raw) ? ids.issue(scope, raw) : undefined;
  return Object.fromEntries(Object.entries(values).flatMap(([id, value]) => {
    const field = fields.find(f => f.id === id);
    if (!field) return [];
    const projected = transformValue(field, question, value, encode);
    return projected === undefined ? [] : [[ids.issue(fieldScope(question), id), projected]];
  }));
}

export function encodeQuizorIds(visible: QuizorView, source: QuizorView, ids: PlayerHandles): QuizorView {
  const question = visible.questionId ?? "";
  const qid = (id: string) => ids.issue("question", id);
  const grade = (id: string) => ids.issue("grade", id);
  const answers = (items: PublicAnswer[], fields: PublicField[], q: string) => items.map(a => ({
    ...a, answers: encodeAnswers(a.answers, fields, q, ids), grade: a.grade && grade(a.grade),
    fields: a.fields.map(g => ({ ...g, fieldId: ids.issue(fieldScope(q), g.fieldId), grade: grade(g.grade) })),
  }));
  return { ...visible,
    questionId: visible.questionId === null ? null : qid(visible.questionId), roundId: ids.issue("round", visible.roundId),
    board: visible.board.map(b => ({ ...b, questionId: qid(b.questionId) })),
    themes: visible.themes.map(t => ({ ...t, questionId: qid(t.questionId) })),
    fields: visible.fields.map(f => fieldView(f, question, ids)),
    grades: visible.grades.map(g => ({ ...g, id: grade(g.id) })),
    judging: visible.judging.map(j => ({ ...j, fieldId: ids.issue(fieldScope(question), j.fieldId),
      grades: j.grades?.map(g => ({ ...g, id: grade(g.id) })) })),
    ownAnswer: visible.ownAnswer && encodeAnswers(visible.ownAnswer, source.fields, question, ids),
    answers: answers(visible.answers, source.fields, question),
    appeal: visible.appeal && { ...visible.appeal, questionId: qid(visible.appeal.questionId) },
    history: visible.history.map((h, i) => {
      const { poll, ...entry } = h;
      return { ...entry, questionId: qid(h.questionId), roundId: ids.issue("round", h.roundId),
        answers: answers(h.answers, source.history[i]?.fields ?? [], h.questionId) };
    }),
  };
}

/** Resolve only handles previously issued for the current public inputs. Unknown handles all take the same rejection path. */
export function decodeQuizorAction(action: Record<string, unknown>, view: QuizorView, ids: PlayerHandles): Record<string, unknown> | null {
  const output = { ...action };
  const question = view.questionId ?? "";
  if ("questionId" in output && output.questionId !== null) {
    const possible = action.type === "select" ? view.board.filter(c => !c.played).map(c => c.questionId)
      : action.type === "ban" ? view.themes.map(t => t.questionId)
      : action.type === "appeal" ? view.history.filter(h => h.disclosed).map(h => h.questionId)
      : view.questionId !== null ? [view.questionId] : [];
    output.questionId = ids.resolve("question", output.questionId, possible);
    if (output.questionId === undefined) return null;
  }

  if ("fieldId" in output) {
    output.fieldId = ids.resolve(fieldScope(question), output.fieldId, view.judging.map(j => j.fieldId));
    if (output.fieldId === undefined) return null;
  }
  if ("grade" in output) {
    const allowed = view.judging.find(j => j.fieldId === output.fieldId && j.seat === view.seat)?.grades ?? view.grades;
    output.grade = ids.resolve("grade", output.grade, allowed.map(g => g.id));
    if (output.grade === undefined) return null;
  }

  if (action.type === "answer" || action.type === "draft") {
    if (typeof output.answers !== "object" || !output.answers || Array.isArray(output.answers)) return null;
    const values: [string, AnswerValue][] = [];
    for (const [handle, value] of Object.entries(output.answers)) {
      const id = ids.resolve(fieldScope(question), handle, view.fields.map(f => f.id));
      const field = view.fields.find(f => f.id === id);
      if (!field) return null;
      const decoded = transformValue(field, question, value, ids.resolve.bind(ids));
      if (decoded === undefined) return null;
      values.push([field.id, decoded]);
    }
    output.answers = Object.fromEntries(values);
  }
  return output;
}
