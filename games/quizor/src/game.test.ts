import { describe, expect, it } from "vitest";
import { createRng, isActionError } from "@asobiba/sdk";
import { quizor, type QuizorState, type QuizorAction } from "./game";
import { rulesSchema, type QuizorRules } from "./rules";

const makeRules = (extra = {}): QuizorRules =>
  rulesSchema.parse({
    rounds: [
      {
        id: "r",
        questions: [
          {
            id: "q",
            prompt: "Секретный вопрос",
            fields: [{ id: "a", type: "text", answers: [{ text: "Москва" }] }],
            reveal: [{ type: "text", text: "Верно: Москва" }],
          },
          {
            id: "future",
            prompt: "Будущий секрет",
            blocks: [{ type: "image", asset: "ast_future000000" }],
            fields: [{ id: "a", type: "oral" }],
            settings: { judge: "self" },
          },
        ],
      },
    ],
    ...extra,
  });
function harness(rules = makeRules(), seats = 2) {
  const rng = createRng(42);
  let now = 1000;
  let state = quizor.setup({ rules, seats, rng, now, round: 0, firstSeat: 0 });
  const ctx = () => ({ rules, seats, rng, now });
  const act = (seat: number, action: QuizorAction) => {
    const result = quizor.applyAction(state, seat, action, ctx());
    expect(isActionError(result)).toBe(false);
    if (!isActionError(result)) state = result;
    return result;
  };
  const control = (role: "host" | "presenter" | "system", action: unknown) => {
    const result = quizor.applyControl!(state, action, { ...ctx(), role });
    if (!isActionError(result)) state = result;
    return result;
  };
  const wake = (at: number) => {
    now = at;
    state = quizor.wake!(state, ctx());
  };
  const start = () => {
    for (
      let i = 0;
      i < 10 &&
      !["answer", "board", "special", "final-ban", "done"].includes(
        state.phase,
      );
      i++
    ) {
      const at = quizor.nextWakeAt!(state);
      if (at !== null) wake(at);
      else act(0, { type: "ready" });
    }
  };
  return {
    get state() {
      return state;
    },
    act,
    control,
    wake,
    start,
    ctx,
  };
}
describe("Quizor engine", () => {
  it("hurries only pending self-paced players and freezes their clocks on pause", () => {
    const rules = rulesSchema.parse({
      defaults: { pacing: "self", timers: { hurrySeconds: 5 } },
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Один",
              fields: [{ id: "a", type: "number", target: 1 }],
            },
          ],
        },
      ],
    });
    const h = harness(rules);
    h.start();
    h.act(0, { type: "answer", answers: { a: 1 } });
    h.act(1, { type: "draft", answers: { a: 1 } });
    h.act(0, { type: "hurry" });
    const deadline = h.ctx().now + 5000;
    expect(quizor.view(h.state, 0).deadline).toBe(null);
    expect(quizor.view(h.state, 1).deadline).toBe(deadline);
    expect(quizor.view(h.state, null).deadline).toBe(deadline);
    expect(quizor.nextWakeAt!(h.state)).toBe(deadline);
    h.control("host", { type: "pause" });
    h.wake(h.ctx().now + 2000);
    h.control("host", { type: "resume" });
    h.wake(h.state.resumeAt!);
    expect(quizor.view(h.state, 1).deadline).toBe(deadline + 5000);
    h.wake(deadline + 5000);
    expect(h.state.phase).toBe("reveal");
    expect(h.state.players.map((p) => p.score)).toEqual([100, 100]);
  });
  it("extends and stops personal answer clocks without restarting a submitted player's timer", () => {
    const rules = rulesSchema.parse({
      defaults: { pacing: "self", timers: { answerSeconds: 10 } },
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Один",
              fields: [{ id: "a", type: "number", target: 1 }],
            },
          ],
        },
      ],
    });
    const h = harness(rules);
    h.start();
    const original = quizor.view(h.state, 1).deadline!;
    h.act(0, { type: "answer", answers: { a: 1 } });
    h.control("presenter", { type: "extend-timer", seconds: 5 });
    expect(quizor.view(h.state, 1).deadline).toBe(original + 5000);
    expect(quizor.view(h.state, 0).deadline).toBe(null);
    expect(h.state.questionDeadline).toBe(null);
    h.control("presenter", { type: "extend-timer", seconds: 0 });
    expect(quizor.view(h.state, 1).deadline).toBe(null);
    expect(quizor.nextWakeAt!(h.state)).toBe(null);
    h.control("presenter", { type: "extend-timer", seconds: 3 });
    expect(quizor.view(h.state, 1).deadline).toBe(h.ctx().now + 3000);
  });
  it.each(["fastest", "trailing"])(
    "rotates turn recipients independently from the %s owner",
    (owner) => {
      const rules = rulesSchema.parse({
        defaults: { recipient: "turn", interception: false },
        rounds: [
          {
            id: "r",
            firstChooser: "order",
            owner,
            questions: Array.from({ length: 2 }, (_, i) => ({
              id: `q${i}`,
              prompt: "Один",
              fields: [{ id: "a", type: "number", target: 1 }],
            })),
          },
        ],
      });
      const h = harness(rules, 3);
      h.control("presenter", { type: "adjust-score", seat: 2, delta: -100 });
      h.start();
      expect(h.state.eligible).toEqual([0]);
      h.act(0, { type: "answer", answers: { a: 1 } });
      for (let i = 0; i < 3; i++) h.act(i, { type: "ready" });
      h.start();
      expect(h.state.owner).toBe(owner === "fastest" ? 0 : 2);
      expect(h.state.eligible).toEqual([1]);
    },
  );
  it.each([false, true])(
    "awards the finite-bank duel leader with directWinner=%s",
    (directWinner) => {
      const q = (id: string) => ({
        id,
        prompt: "Один",
        fields: [{ id: "a", type: "number", target: 1 }],
      });
      const rules = rulesSchema.parse({
        rounds: [{ id: "r", questions: [q("q")] }],
        final: {
          type: "duel",
          eligibility: "all",
          wins: 3,
          bonus: 10,
          directWinner,
          questions: [q("f")],
        },
      });
      const h = harness(rules);
      h.start();
      h.act(0, { type: "answer", answers: { a: 1 } });
      h.act(1, { type: "answer", answers: { a: 2 } });
      h.control("presenter", { type: "adjust-score", seat: 0, delta: 1000 });
      h.act(0, { type: "ready" });
      h.act(1, { type: "ready" });
      h.start();
      h.act(1, { type: "buzz", reactionMs: 0 });
      h.wake(h.state.buzzDeadline!);
      h.act(1, { type: "answer", answers: { a: 1 } });
      h.act(0, { type: "ready" });
      h.act(1, { type: "ready" });
      expect(h.state.players[1].duelWins).toBe(1);
      expect(h.state.players[1].score).toBe(110);
      expect(h.state.result?.winners).toEqual([directWinner ? 1 : 0]);
    },
  );
  it("resolves pending votes by the cast majority when the voting timer expires", () => {
    const rules = rulesSchema.parse({
      defaults: { judge: "vote" },
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Слово",
              fields: [{ id: "a", type: "oral", reference: "Да" }],
            },
          ],
        },
      ],
    });
    const h = harness(rules, 3);
    h.start();
    for (let i = 0; i < 3; i++)
      h.act(i, { type: "answer", answers: { a: true } });
    h.act(0, { type: "vote", seat: 1, fieldId: "a", accept: true });
    h.wake(h.state.deadline!);
    expect(h.state.players[1].score).toBe(100);
  });
  it("falls back from an optional presenter who disconnects during judging", () => {
    const h = harness(makeRules({ presenter: "optional" }), 1);
    h.control("system", { type: "presenter-presence", online: true });
    h.start();
    h.act(0, { type: "answer", answers: { a: "Москва" } });
    expect(h.state.phase).toBe("judging");
    h.control("system", { type: "presenter-presence", online: false });
    expect(h.state.phase).toBe("reveal");
    expect(h.state.players[0].score).toBe(100);
  });
  it("reveals neither future content nor answer criteria in views and presentRules", () => {
    const h = harness();
    h.start();
    const player = JSON.stringify(quizor.view(h.state, 0));
    expect(player).toContain("Секретный вопрос");
    expect(player).not.toContain("Москва");
    expect(player).not.toContain("future-asset");
    expect(player).not.toContain("Будущий секрет");
    expect(JSON.stringify(quizor.presentRules!(makeRules()))).not.toContain(
      "Москва",
    );
    h.act(0, { type: "answer", answers: { a: "Москва" } });
    expect(JSON.stringify(quizor.view(h.state, 1))).not.toContain("Москва");
    h.act(1, { type: "answer", answers: { a: "нет" } });
    expect(h.state.phase).toBe("reveal");
    expect(quizor.view(h.state, null).players[0].score).toBe(100);
  });
  it("requires trusted roles for controls and system-only presence", () => {
    const h = harness();
    h.start();
    expect(
      isActionError(
        h.control("host", { type: "adjust-score", seat: 0, delta: 5 }),
      ),
    ).toBe(true);
    expect(
      isActionError(
        h.control("presenter", { type: "presence", seat: 0, online: false }),
      ),
    ).toBe(true);
    expect(
      isActionError(
        quizor.applyAction(
          h.state,
          0,
          { type: "pause" } as unknown as QuizorAction,
          h.ctx(),
        ),
      ),
    ).toBe(true);
    expect(
      isActionError(
        h.control("presenter", { type: "adjust-score", seat: 0, delta: 5 }),
      ),
    ).toBe(false);
  });
  it("freezes deadlines on pause and resumes after a three second countdown", () => {
    const h = harness(
      makeRules({ defaults: { timers: { answerSeconds: 10 } } }),
    );
    h.start();
    const deadline = h.state.deadline!;
    h.control("host", { type: "pause" });
    expect(quizor.nextWakeAt!(h.state)).toBe(null);
    h.wake(deadline + 5000);
    expect(h.state.phase).toBe("answer");
    h.control("host", { type: "resume" });
    expect(h.state.resumeAt).toBe(deadline + 8000);
    h.wake(deadline + 8000);
    expect(h.state.deadline).toBe(deadline + 18000);
    expect(h.state.paused).toBe(false);
  });
  it("applies solo appeal immediately and keeps immutable history", () => {
    const h = harness(makeRules(), 1);
    h.start();
    h.act(0, { type: "answer", answers: { a: "нет" } });
    const before = structuredClone(h.state);
    h.act(0, {
      type: "appeal",
      questionId: "q",
      seat: 0,
      points: 75,
      comment: "Уточнение",
    });
    expect(h.state.players[0].score).toBe(75);
    expect(before.players[0].score).toBe(0);
  });
  it("records a draft and submits it at the server deadline", () => {
    const h = harness(
      makeRules({ defaults: { timers: { answerSeconds: 2 } } }),
    );
    h.start();
    h.act(0, { type: "draft", answers: { a: "Москва" } });
    h.wake(h.state.deadline!);
    expect(h.state.phase).toBe("reveal");
    expect(h.state.players[0].score).toBe(100);
  });
  it("gives transfers only to the selected recipient and stakes both signs", () => {
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Один",
              special: { type: "transfer" },
              fields: [{ id: "a", type: "number", target: 1 }],
            },
          ],
        },
      ],
    });
    const h = harness(rules);
    h.start();
    expect(h.state.phase).toBe("special");
    h.act(h.state.owner, { type: "transfer", seat: 1 });
    h.start();
    expect(quizor.view(h.state, 0).canAnswer).toBe(false);
    expect(quizor.view(h.state, 1).canAnswer).toBe(true);
    h.act(1, { type: "answer", answers: { a: 1 } });
    expect(h.state.players[1].score).toBe(100);
  });
  it("opens interception after the designated recipient makes a mistake", () => {
    const rules = rulesSchema.parse({
      defaults: { recipient: "owner", interception: true },
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Число",
              fields: [{ id: "a", type: "number", target: 1 }],
            },
          ],
        },
      ],
    });
    const h = harness(rules);
    h.start();
    const owner = h.state.owner;
    h.act(owner, { type: "answer", answers: { a: 2 } });
    expect(h.state.phase).toBe("answer");
    expect(h.state.eligible).toContain(1 - owner);
    expect(quizor.view(h.state, 1 - owner).legal).toContain("buzz");
  });
  it("allows equal independent sealed bids and resolves the tie by trailing score", () => {
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Ставка",
              special: { type: "auction", auction: "sealed" },
              fields: [{ id: "a", type: "number", target: 1 }],
            },
          ],
        },
      ],
    });
    const h = harness(rules);
    h.start();
    h.act(0, { type: "bid", amount: 100 });
    h.act(1, { type: "bid", amount: 100 });
    expect(h.state.eligible).toHaveLength(1);
    h.start();
    h.act(h.state.eligible[0], { type: "answer", answers: { a: 2 } });
    expect(h.state.players[h.state.eligible[0]].score).toBe(-100);
  });
  it("exposes chosen media only for preload and keeps presenter notes private", () => {
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Картинка",
              blocks: [{ type: "image", asset: "ast_chosen000000" }],
              fields: [
                {
                  id: "a",
                  type: "text",
                  notes: "Принимать фамилию",
                  answers: [{ text: "Пушкин" }],
                },
              ],
            },
          ],
        },
      ],
    });
    const h = harness(rules);
    h.wake(h.state.deadline!);
    const v = quizor.view(h.state, 0);
    expect(v.preload).toEqual([{ asset: "ast_chosen000000", type: "image" }]);
    expect(v.prompt).toBe("");
    expect(v.round).toBe(1);
    expect(JSON.stringify(v)).not.toContain("Принимать фамилию");
    expect(quizor.presenterView!(h.state).presenterNotes).toContain(
      "Принимать фамилию",
    );
  });
  it("does not let first self-paced player starve the other players", () => {
    const rules = rulesSchema.parse({
      defaults: { pacing: "self" },
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Два блока",
              blocks: [
                { type: "text", text: "Раз" },
                { type: "text", text: "Два" },
              ],
              fields: [{ id: "a", type: "number", target: 1 }],
            },
          ],
        },
      ],
    });
    const h = harness(rules);
    h.act(0, { type: "ready" });
    h.act(1, { type: "ready" });
    h.act(0, { type: "ready" });
    h.act(1, { type: "ready" });
    h.act(0, { type: "next-block" });
    expect(quizor.view(h.state, 0).blocks).toHaveLength(2);
    expect(quizor.view(h.state, 1).blocks).toHaveLength(1);
    h.act(0, { type: "next-block" });
    expect(quizor.view(h.state, 0).canAnswer).toBe(true);
    expect(quizor.view(h.state, 1).canAnswer).toBe(false);
    h.act(0, { type: "answer", answers: { a: 1 } });
    expect(quizor.currentSeats(h.state)).toContain(1);
  });
  it("ends a race at the configured correct count", () => {
    const questions = Array.from({ length: 3 }, (_, i) => ({
      id: `q${i}`,
      prompt: "Число",
      fields: [{ id: "a", type: "number", target: 1 }],
    }));
    const h = harness(
      rulesSchema.parse({ rounds: [{ id: "r", winsToEnd: 1, questions }] }),
    );
    h.start();
    h.act(0, { type: "answer", answers: { a: 1 } });
    h.act(1, { type: "answer", answers: { a: 2 } });
    h.act(0, { type: "ready" });
    h.act(1, { type: "ready" });
    expect(h.state.phase).toBe("done");
  });
  it("keeps deferred answers and score changes secret until the round ends", () => {
    const h = harness(makeRules({ defaults: { reveal: "round" } }));
    h.start();
    h.act(0, { type: "answer", answers: { a: "Москва" } });
    h.act(1, { type: "answer", answers: { a: "нет" } });
    const v = quizor.view(h.state, 1);
    expect(v.players[0].score).toBe(0);
    expect(v.answers).toEqual([]);
    expect(v.history).toEqual([]);
    expect(v.reference).toBe("");
  });
  it("grades mixed self fields independently without overwriting the algorithm field", () => {
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Проверка",
              fields: [
                { id: "n", type: "number", target: 1 },
                {
                  id: "oral",
                  type: "oral",
                  reference: "Слово",
                  settings: { judge: "self" },
                },
              ],
            },
          ],
        },
      ],
    });
    const h = harness(rules, 1);
    h.start();
    h.act(0, { type: "answer", answers: { n: 1, oral: true } });
    h.act(0, { type: "self-grade", grade: "correct" });
    expect(h.state.players[0].score).toBe(200);
    expect(
      h.state.history[0].answers[0].fields.find((f) => f.fieldId === "n")
        ?.correct,
    ).toBe(true);
  });
  it("adds speed rank, streak and uniqueness bonuses exactly once", () => {
    const h = harness(
      makeRules({
        defaults: {
          bonuses: {
            speed: "rank",
            rankPoints: [30],
            streakEvery: 1,
            streakMultiplier: 2,
            streakBonus: 10,
            uniqueBonus: 20,
          },
        },
      }),
    );
    h.start();
    h.act(0, { type: "answer", answers: { a: "Москва" } });
    h.act(1, { type: "answer", answers: { a: "нет" } });
    expect(h.state.players[0].score).toBe(290);
    expect(isActionError(h.control("presenter", { type: "award-all" }))).toBe(
      true,
    );
    expect(h.state.players[0].score).toBe(290);
  });
  it("keeps already shown question media in history after advancing", () => {
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Фото",
              blocks: [{ type: "image", asset: "ast_seen000000" }],
              fields: [{ id: "a", type: "number", target: 1 }],
            },
            {
              id: "q2",
              prompt: "Дальше",
              fields: [{ id: "a", type: "number", target: 1 }],
            },
          ],
        },
      ],
    });
    const h = harness(rules, 1);
    h.start();
    h.act(0, { type: "answer", answers: { a: 1 } });
    h.act(0, { type: "ready" });
    expect(quizor.view(h.state, 0).history[0].blocks).toEqual([
      expect.objectContaining({ asset: "ast_seen000000" }),
    ]);
  });
  it("removes a final theme as a group and keeps only the requested number of themes", () => {
    const q = (id: string, theme: string) => ({
      id,
      theme,
      prompt: id,
      fields: [{ id: "a", type: "number", target: 1 }],
    });
    const rules = rulesSchema.parse({
      rounds: [{ id: "r", questions: [q("q", "Старт")] }],
      final: {
        type: "elimination-wager",
        eligibility: "all",
        minimumWager: 1,
        questions: [q("f1", "Наука"), q("f2", "Наука"), q("f3", "Музыка")],
      },
    });
    const h = harness(rules, 1);
    h.start();
    h.act(0, { type: "answer", answers: { a: 1 } });
    h.act(0, { type: "ready" });
    h.act(0, { type: "ban", questionId: "f1" });
    expect(h.state.remaining).toEqual([]);
    expect(h.state.active?.question.id).toBe("f3");
  });
  it("freezes appeal voting time but accepts votes on pause", () => {
    const h = harness(makeRules(), 3);
    h.start();
    for (let i = 0; i < 3; i++)
      h.act(i, { type: "answer", answers: { a: i === 0 ? "Москва" : "нет" } });
    h.act(1, {
      type: "appeal",
      questionId: "q",
      seat: 1,
      points: 100,
      comment: "Зачесть",
    });
    h.control("host", { type: "pause" });
    h.act(0, { type: "appeal-vote", accept: true });
    h.act(2, { type: "appeal-vote", accept: false });
    expect(h.state.appeal).toBe(null);
    expect(h.state.players[1].score).toBe(0);
  });
  it("keeps an ongoing question timer while buzz answers hand over", () => {
    const rules = rulesSchema.parse({
      defaults: { mode: "buzz", timers: { answerSeconds: 5, buzzSeconds: 30 } },
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Один",
              fields: [{ id: "a", type: "number", target: 1 }],
            },
          ],
        },
      ],
    });
    const h = harness(rules);
    h.start();
    const deadline = h.state.deadline!;
    h.act(0, { type: "buzz", reactionMs: 0 });
    h.wake(h.state.buzzDeadline!);
    h.act(0, { type: "answer", answers: { a: 2 } });
    h.wake(deadline);
    expect(h.state.phase).toBe("reveal");
  });
  it("supports extra configured buzz attempts and keeps failed-attempt penalties", () => {
    const rules = rulesSchema.parse({
      defaults: { mode: "buzz", attempts: 2 },
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Один",
              fields: [{ id: "a", type: "number", target: 1 }],
            },
          ],
        },
      ],
    });
    const h = harness(rules);
    h.start();
    h.act(0, { type: "buzz", reactionMs: 0 });
    h.wake(h.state.buzzDeadline!);
    h.act(0, { type: "answer", answers: { a: 2 } });
    expect(quizor.view(h.state, 0).legal).toContain("buzz");
    h.act(0, { type: "buzz", reactionMs: 0 });
    h.wake(h.state.buzzDeadline!);
    h.act(0, { type: "answer", answers: { a: 1 } });
    expect(h.state.players[0].score).toBe(0);
  });
  it("shuffles options deterministically without exposing grades", () => {
    const rules = rulesSchema.parse({
      defaults: { shuffleOptions: "shared" },
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Выбор",
              fields: [
                {
                  id: "a",
                  type: "choice",
                  options: Array.from({ length: 8 }, (_, i) => ({
                    id: String(i),
                    text: String(i),
                    grade: i === 0 ? "correct" : "miss",
                  })),
                },
              ],
            },
          ],
        },
      ],
    });
    const h = harness(rules);
    h.start();
    const a = quizor.view(h.state, 0).fields[0].options!;
    expect(a.map((o) => o.id)).not.toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
    expect(quizor.view(h.state, 1).fields[0].options).toEqual(a);
    expect(a.some((o) => "grade" in o)).toBe(false);
  });
  it("eliminates errors only for the round then restores seats for the next round", () => {
    const q = (id: string) => ({
      id,
      prompt: "Один",
      fields: [{ id: "a", type: "number", target: 1 }],
    });
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          eliminateOnError: true,
          survivors: 1,
          questions: [q("q"), q("spare")],
        },
        { id: "r2", questions: [q("last")] },
      ],
    });
    const h = harness(rules);
    h.start();
    h.act(0, { type: "answer", answers: { a: 1 } });
    h.act(1, { type: "answer", answers: { a: 2 } });
    expect(quizor.view(h.state, 1).players[1].out).toBe(true);
    h.act(0, { type: "ready" });
    expect(h.state.roundId).toBe("r2");
    expect(quizor.view(h.state, 1).players[1].out).toBe(false);
  });
  it("ignores delayed readiness from an older phase without advancing the current question", () => {
    const h = harness();
    h.start();
    const before = h.state.active?.question.id;
    const result = quizor.applyAction(
      h.state,
      0,
      { type: "ready", questionId: "q", phase: "preload" } as QuizorAction,
      h.ctx(),
    );
    expect(isActionError(result)).toBe(false);
    if (!isActionError(result)) {
      expect(result.phase).toBe("answer");
      expect(result.active?.question.id).toBe(before);
    }
  });
  it("records presence on pause and delays automatic closing until resume", () => {
    const h = harness();
    h.start();
    h.act(0, { type: "answer", answers: { a: "Москва" } });
    h.control("host", { type: "pause" });
    h.control("system", { type: "presence", seat: 1, online: false });
    expect(h.state.phase).toBe("answer");
    h.control("host", { type: "resume" });
    h.wake(h.state.resumeAt!);
    expect(h.state.phase).toBe("reveal");
  });
  it("votes for best answers independently for each field", () => {
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Подписи",
              fields: [
                {
                  id: "a",
                  type: "text",
                  settings: { judge: "best", value: 10 },
                },
                {
                  id: "b",
                  type: "text",
                  settings: { judge: "best", value: 20 },
                },
              ],
            },
          ],
        },
      ],
    });
    const h = harness(rules, 2);
    h.start();
    h.act(0, { type: "answer", answers: { a: "A", b: "B" } });
    h.act(1, { type: "answer", answers: { a: "C", b: "D" } });
    h.act(0, { type: "vote", seat: 1, fieldId: "a" });
    h.act(1, { type: "vote", seat: 0, fieldId: "a" });
    expect(h.state.phase).toBe("judging");
    h.act(0, { type: "vote", seat: 1, fieldId: "b" });
    h.act(1, { type: "vote", seat: 0, fieldId: "b" });
    expect(h.state.players.map((p) => p.score)).toEqual([30, 30]);
  });
  it("uses secret answers for a wager final even when the quiz uses the buzzer", () => {
    const q = (id: string) => ({
      id,
      prompt: "Один",
      fields: [{ id: "a", type: "number", target: 1 }],
    });
    const rules = rulesSchema.parse({
      defaults: { mode: "buzz" },
      rounds: [{ id: "r", questions: [q("q")] }],
      final: {
        type: "wager",
        eligibility: "all",
        minimumWager: 1,
        questions: [q("f")],
      },
    });
    const h = harness(rules);
    h.start();
    h.act(0, { type: "buzz", reactionMs: 0 });
    h.wake(h.state.buzzDeadline!);
    h.act(0, { type: "answer", answers: { a: 1 } });
    h.act(0, { type: "ready" });
    h.act(1, { type: "ready" });
    h.act(0, { type: "bid", amount: 20 });
    h.act(1, { type: "bid", amount: 1 });
    h.start();
    expect(quizor.view(h.state, 1).canAnswer).toBe(true);
    h.act(0, { type: "answer", answers: { a: 1 } });
    h.act(1, { type: "answer", answers: { a: 2 } });
    expect(h.state.players.map((p) => p.score)).toEqual([120, -1]);
  });
  it("awards duel direct victory to the first finalist reaching the target", () => {
    const q = (id: string) => ({
      id,
      prompt: "Один",
      fields: [{ id: "a", type: "number", target: 1 }],
    });
    const rules = rulesSchema.parse({
      rounds: [{ id: "r", questions: [q("q")] }],
      final: {
        type: "duel",
        eligibility: "all",
        wins: 1,
        bonus: 10,
        directWinner: true,
        questions: [q("f")],
      },
    });
    const h = harness(rules);
    h.start();
    h.act(0, { type: "answer", answers: { a: 1 } });
    h.act(1, { type: "answer", answers: { a: 2 } });
    h.act(0, { type: "ready" });
    h.act(1, { type: "ready" });
    h.start();
    h.act(1, { type: "buzz", reactionMs: 0 });
    h.wake(h.state.buzzDeadline!);
    h.act(1, { type: "answer", answers: { a: 1 } });
    h.act(0, { type: "ready" });
    h.act(1, { type: "ready" });
    expect(h.state.result?.winners).toEqual([1]);
  });
  it("keeps all survival finalists if everybody misses the same question", () => {
    const q = (id: string) => ({
      id,
      prompt: "Один",
      fields: [{ id: "a", type: "number", target: 1 }],
    });
    const rules = rulesSchema.parse({
      rounds: [{ id: "r", questions: [q("q")] }],
      final: {
        type: "survival",
        eligibility: "all",
        questions: [q("f"), q("f2")],
      },
    });
    const h = harness(rules);
    h.start();
    h.act(0, { type: "answer", answers: { a: 1 } });
    h.act(1, { type: "answer", answers: { a: 2 } });
    h.act(0, { type: "ready" });
    h.act(1, { type: "ready" });
    h.start();
    h.act(0, { type: "answer", answers: { a: 2 } });
    h.act(1, { type: "answer", answers: { a: 2 } });
    h.act(0, { type: "ready" });
    h.act(1, { type: "ready" });
    expect(h.state.finalSeats).toEqual([0, 1]);
    expect(h.state.active?.question.id).toBe("f2");
  });
  it("shows intro and reveal blocks in sequence on persistent server timestamps", () => {
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          intro: [
            { type: "text", text: "Заставка 1", durationSeconds: 2 },
            { type: "text", text: "Заставка 2", durationSeconds: 3 },
          ],
          questions: [
            {
              id: "q",
              prompt: "Один",
              fields: [{ id: "a", type: "number", target: 1 }],
              reveal: [
                { type: "text", text: "Ответ 1", durationSeconds: 2 },
                { type: "text", text: "Ответ 2", durationSeconds: 3 },
              ],
            },
          ],
        },
      ],
    });
    const h = harness(rules, 1);
    expect(quizor.view(h.state, 0).blocks).toHaveLength(1);
    h.wake(h.state.deadline!);
    expect(h.state.phase).toBe("intro");
    expect(quizor.view(h.state, 0).blocks).toHaveLength(2);
    h.start();
    h.act(0, { type: "answer", answers: { a: 1 } });
    const at = quizor.view(h.state, 0).revealStartedAt;
    expect(quizor.view(h.state, 0).reveal).toHaveLength(1);
    h.wake(h.state.blockDeadline!);
    expect(quizor.view(h.state, 0).reveal).toHaveLength(2);
    expect(quizor.view(h.state, 0).revealStartedAt).toBe(at);
  });
  it("does not offer a simulation buzz before the button opens", () => {
    const rules = rulesSchema.parse({
      defaults: { mode: "buzz" },
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Один",
              blocks: [
                { type: "text", text: "Дождитесь конца", durationSeconds: 2 },
              ],
              fields: [{ id: "a", type: "number", target: 1 }],
            },
          ],
        },
      ],
    });
    const h = harness(rules);
    h.act(0, { type: "ready" });
    h.act(1, { type: "ready" });
    h.act(0, { type: "ready" });
    h.act(1, { type: "ready" });
    expect(h.state.phase).toBe("show");
    expect(quizor.legalActions(h.state, 0, h.ctx())).toEqual([]);
  });
  it("uses seeded shuffled themes on the board", () => {
    const rules = rulesSchema.parse({
      defaults: { shuffleThemes: true },
      rounds: [
        {
          id: "r",
          format: "board",
          themes: ["А", "Б", "В", "Г", "Д"],
          values: [100],
          questions: Array.from({ length: 5 }, (_, i) => ({
            id: `q${i}`,
            theme: ["А", "Б", "В", "Г", "Д"][i],
            prompt: "Один",
            fields: [{ id: "a", type: "number", target: 1 }],
          })),
        },
      ],
    });
    const h = harness(rules);
    h.start();
    expect(quizor.view(h.state, 0).board.map((c) => c.theme)).not.toEqual([
      "А",
      "Б",
      "В",
      "Г",
      "Д",
    ]);
  });
  it("clears the preload deadline after media becomes ready early", () => {
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Три блока",
              blocks: [
                { type: "text", text: "Раз", durationSeconds: 6 },
                { type: "text", text: "Два", durationSeconds: 5 },
                { type: "text", text: "Три", durationSeconds: 2 },
              ],
              fields: [{ id: "a", type: "number", target: 1 }],
            },
          ],
        },
      ],
    });
    const h = harness(rules, 1);
    h.act(0, { type: "ready" });
    const preloadDeadline = h.state.deadline!;
    h.act(0, { type: "ready" });
    h.wake(h.state.blockDeadline!);
    h.wake(preloadDeadline);
    expect(h.state.phase).toBe("show");
    h.wake(h.state.blockDeadline!);
    expect(h.state.blockIndex).toBe(2);
  });
  it("lets a present presenter review automatic grades before disclosure", () => {
    const h = harness(makeRules({ presenter: "optional" }), 1);
    h.control("system", { type: "presenter-presence", online: true });
    h.start();
    h.act(0, { type: "answer", answers: { a: "Москва" } });
    expect(h.state.phase).toBe("judging");
    expect(h.state.players[0].score).toBe(0);
    h.control("presenter", { type: "next" });
    expect(h.state.phase).toBe("reveal");
    expect(h.state.players[0].score).toBe(100);
    expect(h.state.deadline).toBe(null);
  });
});
