import { describe, expect, it } from "vitest";
import { Match, documentSchema } from "@asobiba/sdk";
import { quizor, type QuizorView } from "./game";

const view = (m: Match, seat: number | null = 0) =>
  m.view(seat).game as QuizorView;
const act = (m: Match, seat: number, action: unknown, at: number) =>
  expect(m.dispatch(seat, action, at)).toEqual({ ok: true });
const control = (
  m: Match,
  action: unknown,
  at: number,
  role: "presenter" | "system" = "presenter",
) => expect(m.dispatchControl(role, action, at)).toEqual({ ok: true });

function start(
  judge: "presenter" | "vote" | "algorithm",
  attempts = 2,
  clock: "question" | "block" | "none" = "none",
) {
  const rules = {
    presenter: judge === "presenter" ? "required" : "none",
    defaults: {
      mode: "buzz",
      judge,
      attempts,
      answerOpen: "first",
      timers: { answerSeconds: clock === "question" ? 30 : 0 },
    },
    rounds: [
      {
        id: "r",
        questions: [
          {
            id: "q",
            prompt: "Ответ",
            blocks:
              clock === "block"
                ? [{ type: "text", text: "Подсказка", durationSeconds: 30 }]
                : [],
            fields:
              judge === "algorithm"
                ? [{ id: "a", type: "number", target: 100 }]
                : [{ id: "a", type: "oral", reference: "Москва" }],
          },
        ],
      },
    ],
  };
  const config = documentSchema(quizor).parse({
    sdk: 1,
    game: "quizor",
    gameVersion: 1,
    rules,
    series: { rounds: 1 },
    timer: { turnSeconds: 0 },
    visual: {},
  });
  const m = Match.start({
    game: quizor,
    config,
    seats: 2,
    seed: 42,
    startedAt: 1000,
  });
  if (judge === "presenter")
    control(m, { type: "presenter-presence", online: true }, 1000, "system");
  while (!["answer", "show"].includes(view(m).phase))
    m.advance(m.nextWakeAt()!);
  return m;
}
function answer(
  m: Match,
  seat: number,
  at: number,
  value: boolean | number = true,
) {
  act(m, seat, { type: "buzz", reactionMs: 0 }, at);
  m.advance(at + 300);
  act(m, seat, { type: "answer", answers: { a: value } }, at + 301);
}

describe("Judged buzzer attempt lifecycle", () => {
  it.each(["presenter", "algorithm"] as const)(
    "counts two actual rejected %s attempts as two penalties",
    (judge) => {
      const m = start(judge);
      const at = view(m).serverNow;
      answer(m, 0, at, judge === "algorithm" ? 0 : true);
      if (judge === "presenter")
        control(
          m,
          { type: "grade", seat: 0, fieldId: "a", grade: "miss" },
          at + 302,
        );
      answer(m, 0, at + 303, judge === "algorithm" ? 0 : true);
      if (judge === "presenter")
        control(
          m,
          { type: "grade", seat: 0, fieldId: "a", grade: "miss" },
          at + 605,
        );
      answer(m, 1, at + 606, judge === "algorithm" ? 100 : true);
      if (judge === "presenter")
        control(
          m,
          { type: "grade", seat: 1, fieldId: "a", grade: "correct" },
          at + 908,
        );
      expect(view(m).phase).toBe("reveal");
      expect(view(m).players.map((p) => p.score)).toEqual([-200, 100]);
    },
  );
  it("still auto-submits a fresh draft entered after a retry starts", () => {
    const m = start("presenter");
    const at = view(m).serverNow;
    answer(m, 0, at);
    control(
      m,
      { type: "grade", seat: 0, fieldId: "a", grade: "miss" },
      at + 302,
    );
    act(m, 0, { type: "buzz", reactionMs: 0 }, at + 303);
    m.advance(at + 603);
    act(m, 0, { type: "draft", answers: { a: true } }, at + 604);
    control(m, { type: "close" }, at + 605);
    expect(view(m).judging.map((p) => p.seat)).toEqual([0]);
    control(
      m,
      { type: "grade", seat: 0, fieldId: "a", grade: "correct" },
      at + 606,
    );
    expect(view(m).phase).toBe("reveal");
    expect(view(m).players[0].score).toBe(0);
  });
  it.each(["question", "block"] as const)(
    "freezes the saved %s deadline while judging is paused",
    (clock) => {
      const m = start("presenter", 1, clock);
      const at = view(m).serverNow;
      answer(m, 0, at);
      control(m, { type: "pause" }, at + 1000);
      control(m, { type: "resume" }, at + 60000);
      m.advance(at + 63000);
      control(
        m,
        { type: "grade", seat: 0, fieldId: "a", grade: "miss" },
        at + 63001,
      );
      expect(view(m).phase).toBe(clock === "block" ? "show" : "answer");
      expect(view(m, 1).legal).toContain("buzz");
      expect(m.nextWakeAt()).toBe(at + 92000);
      expect(view(m).deadline).toBe(clock === "question" ? at + 92000 : null);
    },
  );
  it.each(["question", "block"] as const)(
    "keeps the original %s deadline when judging is not paused",
    (clock) => {
      const m = start("presenter", 1, clock);
      const at = view(m).serverNow;
      answer(m, 0, at);
      control(
        m,
        { type: "grade", seat: 0, fieldId: "a", grade: "miss" },
        at + 1000,
      );
      expect(view(m).phase).toBe(clock === "block" ? "show" : "answer");
      expect(m.nextWakeAt()).toBe(at + 30000);
    },
  );
  it("collects fresh votes for the same player's second attempt", () => {
    const m = start("vote");
    const at = view(m).serverNow;
    answer(m, 0, at);
    act(m, 1, { type: "vote", seat: 0, fieldId: "a", accept: false }, at + 302);
    answer(m, 0, at + 303);
    expect(view(m, 1).legal).toContain("vote");
    act(m, 1, { type: "vote", seat: 0, fieldId: "a", accept: true }, at + 605);
    expect(view(m).phase).toBe("reveal");
    expect(view(m).answers.find((a) => a.seat === 0)).toMatchObject({
      correct: true,
      points: 0,
    });
  });
  it.each([1, 2])(
    "preserves one rejected attempt without resubmitting its old draft with %s attempt(s)",
    (attempts) => {
      const m = start("presenter", attempts);
      const at = view(m).serverNow;
      answer(m, 0, at);
      control(
        m,
        { type: "grade", seat: 0, fieldId: "a", grade: "miss" },
        at + 302,
      );
      answer(m, 1, at + 303);
      expect(view(m).judging.map((p) => p.seat)).toEqual([1]);
      control(
        m,
        { type: "grade", seat: 1, fieldId: "a", grade: "correct" },
        at + 605,
      );
      expect(view(m).phase).toBe("reveal");
      expect(view(m).players.map((p) => p.score)).toEqual([-100, 100]);
      expect(view(m).answers.find((a) => a.seat === 0)).toMatchObject({
        answers: { a: true },
        grade: "miss",
        points: -100,
      });
    },
  );
  it("preserves an algorithm-rejected attempt without treating its old draft as another try", () => {
    const m = start("algorithm");
    const at = view(m).serverNow;
    answer(m, 0, at, 0);
    answer(m, 1, at + 302, 100);
    expect(view(m).phase).toBe("reveal");
    expect(view(m).players.map((p) => p.score)).toEqual([-100, 100]);
    expect(view(m).answers.find((a) => a.seat === 0)).toMatchObject({
      answers: { a: 0 },
      grade: "miss",
      points: -100,
    });
  });
});
