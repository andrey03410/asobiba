import { describe, expect, it } from "vitest";
import {
  Match,
  documentSchema,
  createRng,
  isActionError,
  simulate,
} from "@asobiba/sdk";
import { quizor, type QuizorView } from "./game";

const question = (id = "q", extra: Record<string, unknown> = {}) => ({
  id,
  prompt: id,
  fields: [{ id: "a", type: "number", target: 100 }],
  ...extra,
});
const match = (rules: Record<string, unknown>, seats = 2) =>
  Match.start({
    game: quizor,
    config: documentSchema(quizor).parse({
      sdk: 1,
      game: "quizor",
      gameVersion: 1,
      rules,
      series: { rounds: 1 },
      timer: { turnSeconds: 0 },
      visual: {},
    }),
    seats,
    seed: 42,
    startedAt: 1000,
  });
const view = (m: Match, seat: number | null = 0) =>
  m.view(seat).game as QuizorView;
function reach(m: Match, phase: string) {
  for (let i = 0; i < 30 && view(m).phase !== phase; i++) {
    const at = m.nextWakeAt();
    if (at === null) break;
    m.advance(at);
  }
  expect(view(m).phase).toBe(phase);
}
const dispatch = (
  m: Match,
  seat: number,
  action: unknown,
  at = view(m).serverNow,
) => {
  const result = m.dispatch(seat, action, at);
  expect(result).toEqual({ ok: true });
};

describe("Quizor reviewed regressions", () => {
  it.each([
    {
      field: {
        id: "a",
        type: "match",
        left: [{ id: "image", text: "Картинка" }, { id: "sound" }],
        right: [
          { id: "x", asset: "ast_media000000" },
          { id: "y", asset: "ast_audio000000", media: "audio" },
        ],
        correct: { image: "x", sound: "y" },
      },
      answer: { image: "x", sound: "y" },
      reference: "Картинка: Вариант 1; sound: Вариант 2",
    },
    {
      field: {
        id: "a",
        type: "choice",
        options: [
          { id: "image", asset: "ast_media000000", grade: "correct" },
          { id: "sound", asset: "ast_audio000000", grade: "miss" },
        ],
      },
      answer: "image",
      reference: "image",
    },
    {
      field: {
        id: "a",
        type: "order",
        items: [
          { id: "image", asset: "ast_media000000" },
          { id: "sound", asset: "ast_audio000000" },
        ],
        correct: ["sound", "image"],
      },
      answer: ["sound", "image"],
      reference: "sound → image",
    },
  ])(
    "builds a readable reference for media-only $field.type options",
    ({ field, answer, reference }) => {
      const m = match(
        {
          rounds: [
            { id: "r", questions: [question("media", { fields: [field] })] },
          ],
        },
        1,
      );
      reach(m, "answer");
      dispatch(m, 0, { type: "answer", answers: { a: answer } });
      expect(view(m).reference).toBe(reference);
      expect(view(m).history[0].reference).toBe(reference);
      expect(view(m).players[0].score).toBe(100);
    },
  );
  it("excludes a passed bidder when the sealed auction settles", () => {
    const m = match(
      {
        defaults: { value: 10 },
        rounds: [
          {
            id: "r",
            questions: [
              question("auction", {
                special: { type: "auction", auction: "sealed" },
              }),
            ],
          },
        ],
      },
      3,
    );
    reach(m, "special");
    for (let seat = 0; seat < 3; seat++)
      expect(
        m.dispatchControl(
          "presenter",
          { type: "adjust-score", seat, delta: 200 },
          view(m).serverNow,
        ),
      ).toEqual({ ok: true });
    dispatch(m, 0, { type: "bid", amount: 100 });
    dispatch(m, 0, { type: "pass" });
    dispatch(m, 1, { type: "bid", amount: 50 });
    dispatch(m, 2, { type: "bid", amount: 60 });
    expect(view(m).eligible).toEqual([2]);
  });
  it.each(["auto", "self"])(
    "simulates timed editable answers without resubmission starvation in %s pacing",
    (pacing) => {
      const config = documentSchema(quizor).parse({
        sdk: 1,
        game: "quizor",
        gameVersion: 1,
        rules: {
          players: { max: 2 },
          defaults: { pacing, editable: true, timers: { answerSeconds: 5 } },
          rounds: [{ id: "r", questions: [question()] }],
        },
        series: { rounds: 1 },
        timer: { turnSeconds: 0 },
        visual: {},
      });
      const result = simulate(quizor, config, { rounds: 2, maxActions: 200 });
      expect(result.finished).toBe(2);
      expect(result.issues).toEqual([]);
    },
  );
  it("offers a valid larger all-in simulation action after an all-in bid", () => {
    const rules = quizor.rulesSchema.parse({
      defaults: { value: 10 },
      rounds: [
        {
          id: "r",
          questions: [question("auction", { special: { type: "auction" } })],
        },
      ],
    });
    const ctx = { rules, seats: 2, rng: createRng(42), now: 1000 };
    let state = quizor.setup({ ...ctx, round: 0, firstSeat: 0 });
    while (state.phase !== "special") {
      ctx.now = quizor.nextWakeAt!(state)!;
      state = quizor.wake!(state, ctx);
    }
    const owner = state.owner,
      other = 1 - owner;
    const control = (action: unknown) => {
      const next = quizor.applyControl!(state, action, {
        ...ctx,
        role: "presenter",
      });
      if (isActionError(next)) throw Error(next.error.message);
      state = next;
    };
    const act = (seat: number, action: unknown) => {
      const next = quizor.applyAction(state, seat, action as never, ctx);
      if (isActionError(next)) throw Error(next.error.message);
      state = next;
    };
    control({ type: "adjust-score", seat: owner, delta: 300 });
    control({ type: "adjust-score", seat: other, delta: 150 });
    act(owner, { type: "bid", amount: 100 });
    act(other, { type: "bid", amount: 150, allIn: true });
    const actions = quizor.legalActions(state, owner, ctx);
    expect(actions).toContainEqual({ type: "bid", amount: 300, allIn: true });
    for (const action of actions)
      expect(isActionError(quizor.applyAction(state, owner, action, ctx))).toBe(
        false,
      );
  });
  it.each(["auto", "self"])(
    "closes untimed editable answers on the final submit in %s pacing",
    (pacing) => {
      const m = match({
        defaults: { pacing, editable: true },
        rounds: [{ id: "r", questions: [question()] }],
      });
      reach(m, "answer");
      dispatch(m, 0, { type: "answer", answers: { a: 0 } });
      expect(view(m).phase).toBe("answer");
      dispatch(m, 0, { type: "answer", answers: { a: 100 } });
      dispatch(m, 1, { type: "answer", answers: { a: 100 } });
      expect(view(m).phase).toBe("reveal");
      expect(view(m).history[0].answers.map((a) => a.points)).toEqual([
        100, 100,
      ]);
    },
  );
  it.each(["auto", "self"])(
    "closes submitted editable answers when their %s timer is stopped",
    (pacing) => {
      const m = match({
        defaults: { pacing, editable: true, timers: { answerSeconds: 5 } },
        rounds: [{ id: "r", questions: [question()] }],
      });
      reach(m, "answer");
      dispatch(m, 0, { type: "answer", answers: { a: 100 } });
      dispatch(m, 1, { type: "answer", answers: { a: 100 } });
      expect(view(m).phase).toBe("answer");
      expect(
        m.dispatchControl(
          "presenter",
          { type: "extend-timer", seconds: 0 },
          view(m).serverNow,
        ),
      ).toEqual({ ok: true });
      expect(view(m).phase).toBe("reveal");
    },
  );
  it("lets an eliminated player vote on another player's appeal", () => {
    const m = match(
      {
        rounds: [
          { id: "r1", eliminateLast: true, questions: [question("first")] },
          { id: "r2", questions: [question("second")] },
        ],
      },
      3,
    );
    reach(m, "answer");
    for (let seat = 0; seat < 3; seat++)
      dispatch(m, seat, {
        type: "answer",
        answers: { a: seat === 2 ? 0 : 100 },
      });
    for (let seat = 0; seat < 3; seat++) dispatch(m, seat, { type: "ready" });
    reach(m, "answer");
    expect(view(m).players[2].out).toBe(true);
    dispatch(m, 0, {
      type: "appeal",
      questionId: "first",
      seat: 0,
      points: 150,
      comment: "Поправка",
    });
    expect(view(m, 2).legal).toContain("appeal-vote");
    dispatch(m, 2, { type: "appeal-vote", accept: true });
    dispatch(m, 1, { type: "appeal-vote", accept: true });
    expect(view(m).players[0].score).toBe(150);
  });
  it("gives the race winner bonus to every seat reaching K in the same secret question", () => {
    const m = match({
      rounds: [
        {
          id: "r",
          winsToEnd: 1,
          winnerBonus: 20,
          questions: [question("first"), question("unused")],
        },
      ],
    });
    reach(m, "answer");
    dispatch(m, 0, { type: "answer", answers: { a: 100 } });
    dispatch(m, 1, { type: "answer", answers: { a: 100 } });
    expect(view(m).players.map((p) => p.score)).toEqual([120, 120]);
    expect(view(m).history[0].answers.map((a) => a.points)).toEqual([120, 120]);
    dispatch(m, 0, { type: "ready" });
    dispatch(m, 1, { type: "ready" });
    expect(view(m).result?.winners).toEqual([0, 1]);
  });
  it("uses field-specific grades to build a choice reference for self-check and history", () => {
    const m = match(
      {
        rounds: [
          {
            id: "r",
            questions: [
              question("choice", {
                fields: [
                  {
                    id: "a",
                    type: "choice",
                    settings: {
                      judge: "self",
                      grades: [
                        {
                          id: "right",
                          label: "Да",
                          fraction: 1,
                          correct: true,
                        },
                        { id: "wrong", label: "Нет", fraction: 0 },
                      ],
                    },
                    options: [
                      { id: "m", text: "Москва", grade: "right" },
                      { id: "r", text: "Рига", grade: "wrong" },
                    ],
                  },
                ],
              }),
            ],
          },
        ],
      },
      1,
    );
    reach(m, "answer");
    dispatch(m, 0, { type: "answer", answers: { a: "m" } });
    expect(view(m).selfReference).toBe("Москва");
    dispatch(m, 0, { type: "self-grade", fieldId: "a", grade: "right" });
    expect(view(m).reference).toBe("Москва");
    expect(view(m).history[0].reference).toBe("Москва");
  });
  it("opens a round score boundary even when every answer is revealed immediately", () => {
    const m = match({
      defaults: { scoreVisibility: "round" },
      rounds: [
        { id: "r1", questions: [question("first")] },
        { id: "r2", questions: [question("second")] },
      ],
    });
    reach(m, "answer");
    dispatch(m, 0, { type: "answer", answers: { a: 100 } });
    dispatch(m, 1, { type: "answer", answers: { a: 0 } });
    expect(view(m).players.map((p) => p.score)).toEqual([null, null]);
    dispatch(m, 0, { type: "ready" });
    dispatch(m, 1, { type: "ready" });
    expect(view(m).phase).toBe("round-reveal");
    expect(view(m).players.map((p) => p.score)).toEqual([100, 0]);
    dispatch(m, 0, { type: "ready" });
    dispatch(m, 1, { type: "ready" });
    expect(view(m).phase).toBe("intro");
    expect(view(m).roundId).toBe("r2");
    expect(view(m).players.map((p) => p.score)).toEqual([null, null]);
  });
  it.each(["draft", "answer"])(
    "rejects a delayed %s from a prior question with the same field id",
    (type) => {
      const m = match({
        rounds: [
          { id: "r", questions: [question("first"), question("second")] },
        ],
      });
      reach(m, "answer");
      dispatch(m, 0, {
        type: "answer",
        answers: { a: 100 },
        questionId: "first",
      });
      dispatch(m, 1, {
        type: "answer",
        answers: { a: 100 },
        questionId: "first",
      });
      reach(m, "answer");
      expect(view(m).questionId).toBe("second");
      expect(
        m.dispatch(
          0,
          { type, answers: { a: 999 }, questionId: "first" },
          view(m).serverNow,
        ),
      ).toMatchObject({ ok: false, error: { code: "stale_question" } });
      expect(view(m).ownAnswer).toBe(null);
      dispatch(m, 0, { type, answers: { a: 100 }, questionId: "second" });
      expect(view(m).ownAnswer).toEqual({ a: 100 });
    },
  );
  it("reveals only the bids of finalists whose answer has been disclosed", () => {
    const m = match({
      rounds: [{ id: "r", questions: [question("seed")] }],
      final: { type: "wager", questions: [question("final")] },
    });
    reach(m, "answer");
    dispatch(m, 0, { type: "answer", answers: { a: 100 } });
    dispatch(m, 1, { type: "answer", answers: { a: 100 } });
    reach(m, "special");
    dispatch(m, 0, { type: "bid", amount: 80 });
    dispatch(m, 1, { type: "bid", amount: 50 });
    reach(m, "answer");
    dispatch(m, 0, { type: "answer", answers: { a: 100 } });
    dispatch(m, 1, { type: "answer", answers: { a: 100 } });
    expect(view(m, null).answers).toEqual([]);
    expect(view(m, null).bids).toEqual({});
    expect(view(m, 0).bids).toEqual({});
    expect(view(m, 0).ownBid).toBe(80);
    expect(view(m, null).history.at(-1)?.answers).toEqual([]);
    expect((m.view(null, "presenter").game as QuizorView).bids).toEqual({
      0: 80,
      1: 50,
    });
    m.advance(m.nextWakeAt()!);
    expect(view(m, null).bids).toEqual({ 0: 80 });
    expect(
      view(m, null)
        .history.at(-1)
        ?.answers.map((a) => a.seat),
    ).toEqual([0]);
    m.advance(m.nextWakeAt()!);
    expect(view(m, null).bids).toEqual({ 0: 80, 1: 50 });
  });
  it.each([0, -5, 30])(
    "bounds wager-all by its nonnegative balance at score %s",
    (score) => {
      const m = match({
        rounds: [
          {
            id: "r",
            questions: [question("wager", { special: { type: "wager-all" } })],
          },
        ],
      });
      reach(m, "special");
      if (score !== 0)
        expect(
          m.dispatchControl(
            "presenter",
            { type: "adjust-score", seat: 0, delta: score },
            view(m).serverNow,
          ),
        ).toEqual({ ok: true });
      expect(view(m).special?.minimum).toBe(0);
      expect(
        m.dispatch(0, { type: "bid", amount: 100 }, view(m).serverNow).ok,
      ).toBe(false);
      dispatch(m, 0, { type: "bid", amount: Math.max(0, score) });
      expect(view(m).ownBid).toBe(Math.max(0, score));
    },
  );
  it.each(["presenter", "vote"])(
    "reopens buzzer interception after a %s judge rejects an oral answer",
    (judge) => {
      const m = match({
        presenter: judge === "presenter" ? "required" : "none",
        defaults: { mode: "buzz", judge },
        rounds: [
          {
            id: "r",
            questions: [
              question("oral", {
                fields: [{ id: "a", type: "oral", reference: "Москва" }],
              }),
            ],
          },
        ],
      });
      if (judge === "presenter")
        expect(
          m.dispatchControl(
            "system",
            { type: "presenter-presence", online: true },
            1000,
          ),
        ).toEqual({ ok: true });
      reach(m, "answer");
      let at = view(m).serverNow;
      dispatch(m, 0, { type: "buzz", reactionMs: 0 }, at);
      m.advance(at + 300);
      dispatch(m, 0, { type: "answer", answers: { a: true } }, at + 301);
      expect(view(m).phase).toBe("judging");
      if (judge === "presenter")
        expect(
          m.dispatchControl(
            "presenter",
            { type: "grade", seat: 0, fieldId: "a", grade: "miss" },
            at + 302,
          ),
        ).toEqual({ ok: true });
      else
        dispatch(
          m,
          1,
          { type: "vote", seat: 0, fieldId: "a", accept: false },
          at + 302,
        );
      expect(view(m).phase).toBe("answer");
      dispatch(m, 1, { type: "buzz", reactionMs: 0 }, at + 303);
      m.advance(at + 603);
      dispatch(m, 1, { type: "answer", answers: { a: true } }, at + 604);
      if (judge === "presenter")
        expect(
          m.dispatchControl(
            "presenter",
            { type: "grade", seat: 1, fieldId: "a", grade: "correct" },
            at + 605,
          ),
        ).toEqual({ ok: true });
      else
        dispatch(
          m,
          0,
          { type: "vote", seat: 1, fieldId: "a", accept: true },
          at + 605,
        );
      expect(view(m).phase).toBe("reveal");
      expect(view(m).players.map((p) => p.score)).toEqual([-100, 100]);
    },
  );
  it("requires all-in to raise an open auction and all-in to beat an existing all-in", () => {
    const m = match({
      defaults: { value: 10 },
      rounds: [
        {
          id: "r",
          questions: [question("auction", { special: { type: "auction" } })],
        },
      ],
    });
    reach(m, "special");
    const owner = view(m).owner,
      other = 1 - owner;
    expect(
      m.dispatchControl(
        "presenter",
        { type: "adjust-score", seat: owner, delta: 200 },
        view(m).serverNow,
      ),
    ).toEqual({ ok: true });
    expect(
      m.dispatchControl(
        "presenter",
        { type: "adjust-score", seat: other, delta: 50 },
        view(m).serverNow,
      ),
    ).toEqual({ ok: true });
    dispatch(m, owner, { type: "bid", amount: 100 });
    expect(
      m.dispatch(
        other,
        { type: "bid", amount: 50, allIn: true },
        view(m).serverNow,
      ).ok,
    ).toBe(false);
    expect(view(m).bids).toEqual({ [owner]: 100 });
    expect(
      m.dispatchControl(
        "presenter",
        { type: "adjust-score", seat: other, delta: 100 },
        view(m).serverNow,
      ),
    ).toEqual({ ok: true });
    dispatch(m, other, { type: "bid", amount: 150, allIn: true });
    expect(
      m.dispatch(owner, { type: "bid", amount: 200 }, view(m).serverNow).ok,
    ).toBe(false);
    dispatch(m, owner, { type: "bid", amount: 200, allIn: true });
    expect(view(m).bids[owner]).toBe(200);
  });
  it.each([false, true])(
    "continues the tie-break stock after no correct answer with interception=%s",
    (interception) => {
      const m = match({
        rounds: [{ id: "r", questions: [question()] }],
        tiebreak: [
          question("tie1"),
          question("tie2", { settings: { interception } }),
          question("tie3"),
        ],
      });
      reach(m, "answer");
      dispatch(m, 0, { type: "answer", answers: { a: 100 } });
      dispatch(m, 1, { type: "answer", answers: { a: 100 } });
      reach(m, "answer");
      dispatch(m, 0, { type: "pass" });
      dispatch(m, 1, { type: "pass" });
      reach(m, "answer");
      let at = view(m).serverNow;
      dispatch(m, 0, { type: "buzz", reactionMs: 0 }, at);
      m.advance(at + 300);
      dispatch(m, 0, { type: "answer", answers: { a: 0 } }, at + 301);
      if (interception) {
        dispatch(m, 1, { type: "buzz", reactionMs: 0 }, at + 302);
        m.advance(at + 602);
        dispatch(m, 1, { type: "pass" }, at + 603);
      }
      reach(m, "answer");
      expect(view(m).questionId).toBe("tie3");
      at = view(m).serverNow;
      dispatch(m, 0, { type: "buzz", reactionMs: 0 }, at);
      m.advance(at + 300);
      dispatch(m, 0, { type: "answer", answers: { a: 100 } }, at + 301);
      reach(m, "done");
      expect(view(m).result?.winners).toEqual([0]);
    },
  );
  it("keeps editable personal clocks until expiry and closes after all budgets expire", () => {
    const m = match({
      defaults: {
        pacing: "self",
        editable: true,
        timers: { answerSeconds: 5 },
      },
      rounds: [{ id: "r", questions: [question()] }],
    });
    reach(m, "answer");
    const at = view(m).serverNow;
    dispatch(m, 0, { type: "answer", answers: { a: 100 } }, at);
    dispatch(m, 1, { type: "answer", answers: { a: 100 } }, at + 1);
    expect(view(m).legal).not.toContain("hurry");
    expect(m.nextWakeAt()).toBe(at + 5000);
    m.advance(at + 5000);
    expect(view(m).phase).toBe("reveal");
    expect(view(m).history[0].answers.map((a) => a.points)).toEqual([100, 100]);
  });
  it("uses each player's self-paced answer opening for the linear speed bonus", () => {
    const m = match({
      defaults: {
        pacing: "self",
        bonuses: { speed: "linear" },
        timers: { answerSeconds: 30 },
      },
      rounds: [{ id: "r", questions: [question()] }],
    });
    reach(m, "answer");
    const at = view(m).serverNow;
    dispatch(m, 0, { type: "answer", answers: { a: 100 } }, at + 10000);
    dispatch(m, 1, { type: "answer", answers: { a: 100 } }, at + 20000);
    expect(view(m).history[0].answers.map((a) => a.points)).toEqual([133, 117]);
  });
  it("ranks nearest against auto-submitted drafts from the same closing snapshot", () => {
    const m = match({
      defaults: { timers: { answerSeconds: 5 } },
      rounds: [
        {
          id: "r",
          questions: [
            question("q", {
              fields: [
                {
                  id: "a",
                  type: "number",
                  target: 100,
                  steps: [{ condition: { type: "nearest" }, grade: "correct" }],
                },
              ],
            }),
          ],
        },
      ],
    });
    reach(m, "answer");
    const at = view(m).serverNow;
    dispatch(m, 0, { type: "answer", answers: { a: 0 } }, at);
    dispatch(m, 1, { type: "draft", answers: { a: 100 } }, at + 1);
    m.advance(at + 5000);
    expect(view(m).history[0].answers.map((a) => a.points)).toEqual([0, 100]);
  });
  it("awards everyone before committing grades or scores", () => {
    const m = match({
      presenter: "optional",
      rounds: [{ id: "r", questions: [question()] }],
    });
    reach(m, "answer");
    expect(
      m.dispatchControl("presenter", { type: "award-all" }, view(m).serverNow),
    ).toEqual({ ok: true });
    expect(view(m).players.map((p) => p.score)).toEqual([100, 100]);
    expect(
      view(m).history[0].answers.map((a) => ({
        grade: a.grade,
        correct: a.correct,
        points: a.points,
      })),
    ).toEqual([
      { grade: "correct", correct: true, points: 100 },
      { grade: "correct", correct: true, points: 100 },
    ]);
  });
  it("authorizes hurry and appeal after submission through the Match gate", () => {
    const m = match({
      rounds: [{ id: "r", questions: [question("first"), question("second")] }],
    });
    reach(m, "answer");
    dispatch(m, 0, { type: "answer", answers: { a: 100 } });
    expect(view(m).legal).toContain("hurry");
    dispatch(m, 0, { type: "hurry" });
    dispatch(m, 1, { type: "answer", answers: { a: 100 } });
    reach(m, "answer");
    dispatch(m, 0, { type: "answer", answers: { a: 100 } });
    expect(view(m).legal).toContain("appeal");
    dispatch(m, 0, {
      type: "appeal",
      questionId: "first",
      seat: 0,
      points: 150,
      comment: "Поправка",
    });
    expect(view(m).appeal?.points).toBe(150);
  });
});
