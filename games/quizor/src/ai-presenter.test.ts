import { describe, expect, it } from "vitest";
import { documentSchema, Match } from "@asobiba/sdk";
import { quizor, quizorCanUseAgentPresenter, quizorCanUseAlgorithm, type QuizorView } from "./index";
import { rulesSchema } from "./rules";

function config(rules: unknown, rounds = 1) {
  return documentSchema(quizor).parse({
    sdk: 1,
    game: "quizor",
    gameVersion: 1,
    rules,
    series: { rounds },
    timer: { turnSeconds: 0 },
    visual: {},
  });
}

function start(rules: unknown, rounds = 1) {
  const options = { game: quizor, config: config(rules, rounds), seats: 2, seed: 42, startedAt: 1000 };
  const match = Match.start(options);
  control(match, "system", { type: "presenter-presence", online: true });
  return { match, options };
}

const gameView = (match: Match, seat: number | null = null, role?: "presenter") =>
  match.view(seat, role).game as QuizorView;
const now = (match: Match) => gameView(match).serverNow;
const wake = (match: Match) => {
  const at = match.nextWakeAt();
  expect(at).not.toBeNull();
  match.advance(at!);
};
const control = (match: Match, role: "presenter" | "system", action: unknown) =>
  expect(match.dispatchControl(role, action, now(match))).toEqual({ ok: true });
const act = (match: Match, seat: number, action: unknown) =>
  expect(match.dispatch(seat, action, now(match))).toEqual({ ok: true });

const writtenQuestion = { id: "written", fields: [{ id: "a", type: "number", target: 100 }] };
const writtenRules = {
  presenter: "required",
  defaults: { judge: "presenter", timers: { preloadSeconds: 0 } },
  rounds: [{ id: "r", questions: [writtenQuestion] }],
};

describe("Quizor AI presenter", () => {
  it("offers one field decision from the finalized answers in the private presenter view", () => {
    const { match } = start({
      presenter: "required",
      defaults: { judge: "presenter", timers: { preloadSeconds: 0 } },
      rounds: [{
        id: "r",
        questions: [{
          id: "q", prompt: "Столица Японии?",
          fields: [{
            id: "city", type: "text", answers: [{ text: "Токио" }],
            notes: "Разрешена транслитерация",
            settings: {
              grades: [
                { id: "exact", label: "Верно", correct: true, points: 50 },
                { id: "incorrect", label: "Неверно", points: 0 },
              ],
            },
          }],
        }, {
          id: "later", prompt: "Будущий вопрос",
          fields: [{ id: "later", type: "text", answers: [{ text: "Скрытый эталон" }] }],
        }],
      }],
    });
    wake(match);
    act(match, 0, { type: "draft", answers: { city: "Личный черновик" } });
    expect(gameView(match, null, "presenter").agentTask).toBeUndefined();
    act(match, 0, { type: "answer", answers: { city: "Tokyo" } });
    act(match, 1, { type: "answer", answers: { city: "Киото" } });

    expect(gameView(match, 0).agentTask).toBeUndefined();
    expect(gameView(match).agentTask).toBeUndefined();
    const task = gameView(match, null, "presenter").agentTask!;
    expect(task).toMatchObject({
      kind: "grade",
      actions: [
        { type: "grade", seat: 0, fieldId: "city", grade: "exact" },
        { type: "grade", seat: 0, fieldId: "city", grade: "incorrect" },
      ],
      context: {
        question: { id: "q", prompt: "Столица Японии?", reference: "Токио" },
        pending: [
          { seat: 0, fieldId: "city", answer: "Tokyo" },
          { seat: 1, fieldId: "city", answer: "Киото" },
        ],
      },
    });
    expect(JSON.stringify(task.context)).toContain("Разрешена транслитерация");
    expect(JSON.stringify(task.context)).not.toMatch(/Личный черновик|Будущий вопрос|Скрытый эталон/);
    control(match, "presenter", task.actions[0]);
    expect(gameView(match, null, "presenter").agentTask).toMatchObject({
      kind: "grade",
      actions: [
        { type: "grade", seat: 1, fieldId: "city", grade: "exact" },
        { type: "grade", seat: 1, fieldId: "city", grade: "incorrect" },
      ],
    });
    expect(gameView(match, null, "presenter").agentTask!.key).not.toBe(task.key);
  });

  it("opens the answer window and advances a manual reveal without offering to close live answers", () => {
    const { match } = start({
      presenter: "required",
      defaults: {
        judge: "algorithm", pacing: "presenter", answerOpen: "presenter",
        advance: "presenter", timers: { preloadSeconds: 0 },
      },
      rounds: [{
        id: "r", questions: [{
          id: "q", blocks: [{ type: "text", text: "Показ" }],
          fields: [{ id: "a", type: "number", target: 100 }],
        }],
      }],
    });
    wake(match);
    expect(gameView(match, null, "presenter").agentTask?.actions).toEqual([{ type: "next-block" }]);
    control(match, "presenter", { type: "next-block" });
    expect(gameView(match, null, "presenter").agentTask?.actions).toEqual([{ type: "open" }]);
    control(match, "presenter", { type: "open" });
    expect(gameView(match, 0).canAnswer).toBe(true);
    expect(gameView(match, null, "presenter").agentTask).toBeUndefined();
    act(match, 0, { type: "answer", answers: { a: 100 } });
    act(match, 1, { type: "answer", answers: { a: 100 } });
    expect(gameView(match, null, "presenter").agentTask?.actions).toEqual([{ type: "next" }]);
    control(match, "presenter", { type: "next" });
    expect(match.view(null).phase).toBe("finished");
  });

  it("offers presenter assignments before players choose a question or start answering", () => {
    const { match } = start({
      presenter: "required",
      defaults: { judge: "algorithm", recipient: "presenter", answerOpen: "presenter", timers: { preloadSeconds: 0 } },
      rounds: [{
        id: "r", format: "board", firstChooser: "presenter", questions: [{
          id: "q", fields: [{ id: "a", type: "number", target: 100 }],
        }],
      }],
    });
    wake(match);
    const chooserTask = gameView(match, null, "presenter").agentTask;
    expect(chooserTask?.actions).toEqual([{ type: "assign", seat: 0 }, { type: "assign", seat: 1 }]);
    control(match, "presenter", { type: "assign", seat: 1 });
    expect(gameView(match, null, "presenter").agentTask).toBeUndefined();
    act(match, 1, { type: "select", questionId: "q" });
    const recipientTask = gameView(match, null, "presenter").agentTask;
    expect(recipientTask?.actions).toEqual(chooserTask?.actions);
    control(match, "presenter", { type: "assign", seat: 0 });
    const openTask = gameView(match, null, "presenter").agentTask;
    expect(openTask?.actions).toEqual([{ type: "open" }]);
    expect(openTask?.key).not.toBe(recipientTask?.key);
    control(match, "presenter", { type: "open" });
    expect(gameView(match, 0).canAnswer).toBe(true);
    expect(gameView(match, 1).canAnswer).toBe(false);
  });

  it("holds a presenter-assigned board and automatically opened answer form until each assignment", () => {
    const { match } = start({
      presenter: "required",
      defaults: { judge: "algorithm", recipient: "presenter", timers: { preloadSeconds: 0 } },
      rounds: [{
        id: "r", format: "board", firstChooser: "presenter", questions: [{
          id: "q", fields: [{ id: "a", type: "number", target: 100 }],
        }],
      }],
    });
    control(match, "system", { type: "presenter-presence", online: true, requireAssignment: true });
    wake(match);
    expect(match.view(null).currentSeats).toEqual([]);
    expect(match.nextWakeAt()).toBeNull();
    expect(match.canRecoverAlgorithm()).toBe(false);
    expect(match.dispatch(0, { type: "select", questionId: "q" }, now(match))).toMatchObject({ ok: false });
    control(match, "presenter", { type: "assign", seat: 1 });
    act(match, 1, { type: "select", questionId: "q" });
    expect(match.view(null).currentSeats).toEqual([]);
    expect(match.canRecoverAlgorithm()).toBe(false);
    expect(gameView(match, 1).canAnswer).toBe(false);
    expect(match.dispatch(1, { type: "answer", answers: { a: 100 } }, now(match))).toMatchObject({ ok: false });
    control(match, "presenter", { type: "assign", seat: 0 });
    expect(gameView(match, 0).canAnswer).toBe(true);
    expect(match.canRecoverAlgorithm()).toBe(true);
    act(match, 0, { type: "answer", answers: { a: 100 } });
    expect(gameView(match).answers[0]).toMatchObject({ seat: 0, points: 100 });
  });

  it("preserves a presenter grade and finishes remaining text evaluations after switching to the algorithm", () => {
    const { match, options } = start({
      presenter: "required",
      defaults: { judge: "presenter", timers: { preloadSeconds: 0 } },
      rounds: [{
        id: "r", questions: [
          { id: "q", fields: [{ id: "a", type: "text", answers: [{ text: "Токио" }] }] },
          { id: "q2", fields: [{ id: "a", type: "text", answers: [{ text: "Москва" }] }] },
        ],
      }],
    });
    wake(match);
    act(match, 0, { type: "answer", answers: { a: "Tokyo" } });
    act(match, 1, { type: "answer", answers: { a: "Токио" } });
    control(match, "presenter", { type: "grade", seat: 0, fieldId: "a", grade: "partial" });
    expect(match.dispatchControl("presenter", { type: "presenter-algorithm" }, now(match)))
      .toMatchObject({ ok: false, error: { code: "control_forbidden" } });
    const pausedAt = now(match);
    expect(match.setPaused("presenter-disconnected", pausedAt)).toEqual({ ok: true });
    expect(match.dispatchControl("system", { type: "presenter-algorithm" }, pausedAt + 10_000))
      .toEqual({ ok: true });
    expect(match.nextWakeAt()).toBeNull();
    expect(match.setPaused(null, pausedAt + 20_000)).toEqual({ ok: true });

    expect(gameView(match).answers.map(({ seat, points }) => ({ seat, points }))).toEqual([
      { seat: 0, points: 50 }, { seat: 1, points: 100 },
    ]);
    expect(options.config.rules.presenter).toBe("required");
    control(match, "system", { type: "presenter-presence", online: true });
    expect(gameView(match).presenterOnline).toBe(false);
    wake(match);
    act(match, 0, { type: "answer", answers: { a: "Москва" } });
    act(match, 1, { type: "answer", answers: { a: "Москва" } });
    expect(gameView(match).phase).toBe("reveal");
    expect(gameView(match, null, "presenter").agentTask).toBeUndefined();
    const finishedAt = match.nextWakeAt()!;
    wake(match);
    expect(match.view(null).phase).toBe("finished");
    const restored = Match.restore({
      game: quizor, config: options.config, record: match.record(), now: finishedAt,
    });
    expect(restored.view(null)).toEqual(match.view(null));
  });

  it("uses the provisional grade to reopen a buzz attempt when switching to the algorithm", () => {
    const { match } = start({
      presenter: "required",
      defaults: { mode: "buzz", judge: "presenter", attempts: 2, timers: { preloadSeconds: 0, answerSeconds: 30 } },
      rounds: [{
        id: "r", questions: [{ id: "q", fields: [{ id: "a", type: "number", target: 100 }] }],
      }],
    });
    wake(match);
    act(match, 0, { type: "buzz", reactionMs: 0 });
    wake(match);
    act(match, 0, { type: "answer", answers: { a: 1 } });
    expect(gameView(match).phase).toBe("judging");

    control(match, "system", { type: "presenter-algorithm" });
    expect(gameView(match).phase).toBe("answer");
    expect(gameView(match, 0).legal).toContain("buzz");
    act(match, 1, { type: "buzz", reactionMs: 0 });
    wake(match);
    act(match, 1, { type: "answer", answers: { a: 100 } });
    expect(gameView(match).phase).toBe("reveal");
    expect(gameView(match).players.map((p) => p.score)).toEqual([-100, 100]);
  });

  it("recovers after a completed oral round and grades the remaining written answers", () => {
    const { match, options } = start({
      presenter: "required",
      defaults: { judge: "presenter", timers: { preloadSeconds: 0 } },
      rounds: [
        {
          id: "oral-round",
          questions: [{ id: "oral", fields: [{ id: "a", type: "oral", reference: "Токио" }] }],
        },
        {
          id: "written-round",
          questions: [{ id: "written", fields: [{ id: "a", type: "number", target: 100 }] }],
        },
      ],
    });
    expect(quizorCanUseAlgorithm(options.config.rules)).toBe(false);
    wake(match);
    act(match, 0, { type: "answer", answers: { a: true } });
    act(match, 1, { type: "answer", answers: { a: true } });
    expect(match.dispatchControl("system", { type: "presenter-algorithm" }, now(match)))
      .toMatchObject({ ok: false, error: { code: "algorithm_unavailable" } });
    control(match, "presenter", { type: "grade", seat: 0, fieldId: "a", grade: "partial" });
    control(match, "presenter", { type: "grade", seat: 1, fieldId: "a", grade: "miss" });
    control(match, "presenter", { type: "next" });
    wake(match);
    act(match, 0, { type: "answer", answers: { a: 100 } });
    act(match, 1, { type: "answer", answers: { a: 100 } });
    expect(gameView(match).phase).toBe("judging");
    control(match, "system", { type: "presenter-algorithm" });
    expect(gameView(match).players.map((player) => player.score)).toEqual([150, 100]);
    expect(gameView(match).history.map(({ questionId }) => questionId)).toEqual(["oral", "written"]);
  });

  it("checks live work including outstanding presenter assignments and pending fields", () => {
    const { match } = start({
      presenter: "required",
      defaults: { judge: "presenter", recipient: "presenter", answerOpen: "presenter", timers: { preloadSeconds: 0 } },
      rounds: [{
        id: "board", format: "board", firstChooser: "presenter", questions: [{
          id: "q", fields: [
            { id: "oral", type: "oral", reference: "Токио" },
            { id: "written", type: "number", target: 100 },
          ],
        }],
      }],
    });
    wake(match);
    expect(match.canRecoverAlgorithm()).toBe(false);
    control(match, "presenter", { type: "assign", seat: 1 });
    act(match, 1, { type: "select", questionId: "q" });
    expect(match.canRecoverAlgorithm()).toBe(false);
    control(match, "presenter", { type: "assign", seat: 0 });
    expect(match.canRecoverAlgorithm()).toBe(false);
    control(match, "presenter", { type: "open" });
    act(match, 0, { type: "answer", answers: { oral: true, written: 100 } });
    expect(match.canRecoverAlgorithm()).toBe(false);
    control(match, "presenter", { type: "grade", seat: 0, fieldId: "oral", grade: "correct" });
    expect(match.canRecoverAlgorithm()).toBe(true);
    control(match, "system", { type: "presenter-algorithm" });
    expect(gameView(match).players[0].score).toBe(200);
  });

  it("keeps fallback unavailable when a future round or final still needs an oral answer", () => {
    const oral = { id: "oral", fields: [{ id: "a", type: "oral", reference: "Токио" }] };
    const written = { id: "written", fields: [{ id: "a", type: "number", target: 100 }] };
    const rules = {
      presenter: "required",
      defaults: { judge: "presenter", timers: { preloadSeconds: 0 } },
      rounds: [{ id: "first", questions: [written] }],
    };
    for (const configured of [
      { ...rules, rounds: [...rules.rounds, { id: "second", questions: [oral] }] },
      { ...rules, final: { type: "survival", questions: [oral] } },
      { ...rules, tiebreak: [oral] },
    ]) {
      const { match } = start(configured);
      wake(match);
      expect(match.canRecoverAlgorithm()).toBe(false);
      expect(match.dispatchControl("system", { type: "presenter-algorithm" }, now(match)))
        .toMatchObject({ ok: false, error: { code: "algorithm_unavailable" } });
    }
  });

  it("checks whether the resolved rules provide a deterministic fallback", () => {
    const supported = {
      id: "q", fields: [{ id: "a", type: "text", answers: [{ text: "Токио" }] }],
    };
    const oral = { id: "t", fields: [{ id: "a", type: "oral", reference: "Токио" }] };
    const rules = {
      presenter: "required", defaults: { judge: "presenter", pacing: "presenter" },
      rounds: [{ id: "r", questions: [supported] }],
    };
    expect(quizorCanUseAlgorithm(rulesSchema.parse(rules))).toBe(true);
    expect(quizorCanUseAlgorithm(rulesSchema.parse({ ...rules, tiebreak: [oral] }))).toBe(false);
    expect(quizorCanUseAlgorithm(rulesSchema.parse({
      ...rules, defaults: { ...rules.defaults, recipient: "presenter" },
    }))).toBe(false);
    expect(quizorCanUseAlgorithm(rulesSchema.parse({
      ...rules, rounds: [{ id: "r", questions: [{ ...supported, fields: [{ id: "a", type: "text" }] }] }],
    }))).toBe(false);
  });

  it("keeps the live presenter through both SDK series rounds", () => {
    const { match } = start(writtenRules, 2);
    control(match, "system", { type: "presenter-presence", online: true, requireAssignment: true });
    const taskKeys: string[] = [];
    for (const round of [1, 2]) {
      wake(match);
      expect(match.view(null).round).toBe(round);
      expect(gameView(match).presenterOnline).toBe(true);
      act(match, 0, { type: "answer", answers: { a: 100 } });
      act(match, 1, { type: "answer", answers: { a: 100 } });
      const task = gameView(match, null, "presenter").agentTask;
      expect(task?.kind).toBe("grade");
      taskKeys.push(task!.key);
      control(match, "presenter", { type: "grade", seat: 0, fieldId: "a", grade: "correct" });
      control(match, "presenter", { type: "grade", seat: 1, fieldId: "a", grade: "partial" });
      control(match, "presenter", { type: "next" });
      expect(match.view(null).phase).toBe(round === 1 ? "intermission" : "finished");
      if (round === 1) wake(match);
    }
    expect(taskKeys[1]).not.toBe(taskKeys[0]);
    expect(match.view(null).scores).toEqual([2, 0]);
  });

  it("uses algorithm recovery during a paused intermission and replays the second round", () => {
    const { match, options } = start({
      ...writtenRules,
      defaults: { ...writtenRules.defaults, timers: { preloadSeconds: 0, revealSeconds: 0.001 } },
    }, 2);
    control(match, "system", { type: "presenter-presence", online: true, requireAssignment: true });
    wake(match);
    act(match, 0, { type: "answer", answers: { a: 100 } });
    act(match, 1, { type: "answer", answers: { a: 100 } });
    control(match, "presenter", { type: "grade", seat: 0, fieldId: "a", grade: "correct" });
    control(match, "presenter", { type: "grade", seat: 1, fieldId: "a", grade: "miss" });
    control(match, "presenter", { type: "next" });
    const advanceAt = match.nextWakeAt()!;
    const pauseAt = match.checkpointAt + 500;
    expect(match.setPaused("presenter-disconnected", pauseAt)).toEqual({ ok: true });
    expect(match.canRecoverAlgorithm()).toBe(true);
    expect(match.dispatchControl("presenter", { type: "presenter-algorithm" }, pauseAt + 100))
      .toMatchObject({ ok: false, error: { code: "paused" } });
    expect(match.dispatchControl("system", { type: "finish-round" }, pauseAt + 100))
      .toMatchObject({ ok: false, error: { code: "control_forbidden" } });
    expect(match.dispatchControl("system", { type: "presenter-algorithm" }, pauseAt + 100))
      .toEqual({ ok: true });
    expect(match.dispatchControl("system", { type: "presence", seat: 1, online: false }, pauseAt + 100))
      .toEqual({ ok: true });
    expect(match.view(null).roundResults).toHaveLength(1);
    expect(match.setPaused(null, pauseAt + 1000)).toEqual({ ok: true });
    expect(match.nextWakeAt()).toBe(advanceAt + 1000);
    wake(match);
    control(match, "system", { type: "presenter-presence", online: true, requireAssignment: true });
    wake(match);
    expect(match.view(null).round).toBe(2);
    expect(gameView(match).presenterOnline).toBe(false);
    expect(gameView(match, 1).canAnswer).toBe(false);
    act(match, 0, { type: "answer", answers: { a: 100 } });
    expect(gameView(match).answers).toContainEqual(expect.objectContaining({ seat: 0, points: 100 }));
    wake(match);
    expect(match.view(null).phase).toBe("finished");
    expect(match.view(null).scores).toEqual([2, 0]);
    const restored = Match.restore({
      game: quizor, config: options.config, record: match.record(), now: match.checkpointAt,
    });
    expect(restored.view(null, "presenter")).toEqual(match.view(null, "presenter"));
  });

  it("replays an older series with the presenter reset between SDK rounds", () => {
    const { match, options } = start(writtenRules, 2);
    wake(match);
    act(match, 0, { type: "answer", answers: { a: 100 } });
    act(match, 1, { type: "answer", answers: { a: 0 } });
    control(match, "presenter", { type: "grade", seat: 0, fieldId: "a", grade: "correct" });
    control(match, "presenter", { type: "grade", seat: 1, fieldId: "a", grade: "miss" });
    control(match, "presenter", { type: "next" });
    wake(match);
    wake(match);
    expect(gameView(match).presenterOnline).toBe(false);
    act(match, 0, { type: "answer", answers: { a: 100 } });
    act(match, 1, { type: "answer", answers: { a: 0 } });
    expect(gameView(match).phase).toBe("reveal");
    wake(match);
    const restored = Match.restore({
      game: quizor, config: options.config, record: match.record(), now: match.checkpointAt,
    });
    expect(restored.view(null)).toEqual(match.view(null));
  });

  it("blocks recovery until repeated oral questions in future SDK rounds are complete", () => {
    const oral = { id: "oral", fields: [{ id: "a", type: "oral", reference: "Токио" }] };
    const { match } = start({
      ...writtenRules,
      rounds: [{ id: "r", questions: [oral, writtenQuestion] }],
    }, 2);
    control(match, "system", { type: "presenter-presence", online: true, requireAssignment: true });
    for (const round of [1, 2]) {
      wake(match);
      act(match, 0, { type: "answer", answers: { a: true } });
      act(match, 1, { type: "answer", answers: { a: true } });
      control(match, "presenter", { type: "grade", seat: 0, fieldId: "a", grade: "correct" });
      control(match, "presenter", { type: "grade", seat: 1, fieldId: "a", grade: "miss" });
      control(match, "presenter", { type: "next" });
      expect(match.canRecoverAlgorithm()).toBe(round === 2);
      if (round === 2) break;
      expect(match.dispatchControl("system", { type: "presenter-algorithm" }, now(match)))
        .toMatchObject({ ok: false, error: { code: "algorithm_unavailable" } });
      act(match, 0, { type: "answer", answers: { a: 100 } });
      act(match, 1, { type: "answer", answers: { a: 100 } });
      control(match, "presenter", { type: "grade", seat: 0, fieldId: "a", grade: "correct" });
      control(match, "presenter", { type: "grade", seat: 1, fieldId: "a", grade: "miss" });
      control(match, "presenter", { type: "next" });
      expect(match.view(null).phase).toBe("intermission");
      expect(match.canRecoverAlgorithm()).toBe(false);
      wake(match);
    }
  });

  it("permits an AI presenter only when oral answers are graded by players", () => {
    const oral = { id: "a", type: "oral", reference: "Токио" };
    for (const [judge, expected] of [
      [undefined, false], ["presenter", false], ["assisted", false], ["self", true], ["vote", true], ["best", true],
    ] as const) {
      const rules = rulesSchema.parse({
        presenter: "required",
        defaults: { judge: "presenter" },
        rounds: [{ id: "r", questions: [{ id: "q", fields: [{ ...oral, settings: judge ? { judge } : undefined }] }] }],
      });
      expect(quizorCanUseAgentPresenter(rules)).toBe(expected);
    }
  });
});
