import { describe, expect, it } from "vitest";
import { createRng, isActionError, presetDocument, validateConfig, createCatalog, type VideoSnapshotSummary } from "@asobiba/sdk";
import { quizor, type QuizorAction, type QuizorView } from "./game";
import { probeQuestion } from "./judge";
import { checkRules, rulesSchema, type QuizorRules } from "./rules";

const SNAPSHOT = "vsn_abcdefABCDEF";
const summary: VideoSnapshotSummary = {
  id: SNAPSHOT,
  title: "Архетипы",
  fps: 30,
  durationInFrames: 600,
  segments: [
    { id: "question", title: "Выбор", from: 0, to: 300 },
    { id: "result", title: "Топ", from: 300, to: 480 },
    { id: "board", title: "Счёт", from: 480, to: 600 },
  ],
  scenes: [
    {
      id: "question-scene/pick", sourceSceneId: "question-scene", segmentId: "question", from: 0, to: 300,
      holds: [{ momentId: "wait", frame: 195 }],
      choices: ["a", "b", "c"].map((p) => ({ choiceId: "favourite", cardId: `card-${p}`, participantId: p })),
      uses: [],
    },
    { id: "result-scene/a", sourceSceneId: "result-scene", segmentId: "result", from: 300, to: 360, holds: [], choices: [], uses: ["votes", "rank", "texts"] },
    { id: "board-scene/p", sourceSceneId: "board-scene", segmentId: "board", from: 480, to: 600, holds: [], choices: [], uses: ["players"] },
  ],
};

const options = ["a", "b", "c"].map((id) => ({ id, text: `Архетип ${id}`, card: `card-${id}` }));
const rules = (extra: Record<string, unknown> = {}): QuizorRules =>
  rulesSchema.parse({
    video: { snapshot: SNAPSHOT },
    defaults: { judge: "poll", poll: { scoring: "majority" }, timers: { preloadSeconds: 0 } },
    rounds: [
      {
        id: "r",
        intro: [{ type: "scene", play: { segmentId: "board" }, data: "scores", durationSeconds: 4 }],
        questions: [
          {
            id: "q",
            prompt: "Кто твой любимец?",
            blocks: [{ type: "scene", play: { segmentId: "question" }, hold: "wait", durationSeconds: 6.5, startSeconds: 0 }],
            fields: [{ id: "pick", type: "choice", options }],
            reveal: [{ type: "scene", play: { segmentId: "result" }, data: "poll", durationSeconds: 6 }],
          },
        ],
      },
    ],
    ...extra,
  });

function harness(r: QuizorRules, seats = 3) {
  const rng = createRng(7);
  let now = 1000;
  let state = quizor.setup({ rules: r, seats, rng, now, round: 0, firstSeat: 0 });
  const ctx = () => ({ rules: r, seats, rng, now });
  return {
    get state() {
      return state;
    },
    view: (seat: number | null) => quizor.view(state, seat) as QuizorView,
    act(seat: number, action: QuizorAction) {
      const result = quizor.applyAction(state, seat, action, ctx());
      expect(isActionError(result)).toBe(false);
      if (!isActionError(result)) state = result;
    },
    wakeNext() {
      const at = quizor.nextWakeAt!(state);
      if (at === null) return false;
      now = at;
      state = quizor.wake!(state, ctx());
      return true;
    },
    get now() {
      return now;
    },
  };
}

describe("Quizor poll judge", () => {
  const field = { id: "pick", type: "choice", options };
  const ask = (scoring: string, answers: string[]) =>
    probeQuestion(
      rulesSchema.parse({ defaults: { judge: "poll", poll: { scoring } }, rounds: [{ id: "r", questions: [{ id: "q", fields: [field] }] }] }),
      "q",
      answers.map((pick) => ({ pick })),
    );

  it("scores the majority, all tied leaders, or nobody", () => {
    expect(ask("majority", ["a", "a", "b"]).map((g) => g.correct)).toEqual([true, true, false]);
    expect(ask("majority", ["a", "b"]).map((g) => g.correct)).toEqual([true, true]);
    const none = ask("none", ["a", "b"]);
    expect(none.map((g) => [g.points, g.label])).toEqual([[0, "Голос учтён"], [0, "Голос учтён"]]);
  });

  it("builds a shared top by places and judges consensus", () => {
    const order = { id: "top", type: "order", items: options };
    const r = rulesSchema.parse({ defaults: { judge: "poll", poll: { scoring: "consensus" } }, rounds: [{ id: "r", questions: [{ id: "q", fields: [order] }] }] });
    expect(checkRules(r).filter((i) => i.severity === "error")).toEqual([]);
    const result = probeQuestion(r, "q", [{ top: ["a", "b", "c"] }, { top: ["a", "c", "b"] }, { top: ["b", "a", "c"] }]);
    // Borda: a = 3+3+2, b = 2+1+3, c = 1+2+1 → a, b, c
    expect(result[0]).toMatchObject({ correct: true });
    expect(result[1].points).toBeGreaterThan(0);
    expect(result[1].correct).toBe(false);
  });

  it("refuses poll outside secret answers and requires a correct order without poll", () => {
    const codes = checkRules(
      rulesSchema.parse({
        defaults: { mode: "buzz" },
        rounds: [{ id: "r", questions: [{ id: "q", settings: { judge: "poll" }, fields: [{ id: "x", type: "text", answers: [{ text: "x" }] }] }, { id: "q2", fields: [{ id: "o", type: "order", items: options }] }] }],
      }),
    ).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["poll_mode", "poll_field", "order_items"]));
  });
});

describe("Quizor video directives", () => {
  it("plays the intro, holds the question scene during answers and shows the poll at reveal", () => {
    const h = harness(rules());
    const intro = h.view(0);
    expect(intro.phase).toBe("intro");
    expect(intro.video).toMatchObject({ snapshot: SNAPSHOT, play: { segmentId: "board" }, hold: null });
    expect(intro.video!.data!.players!.map((p) => p.id)).toEqual(["seat-0", "seat-1", "seat-2"]);
    expect(intro.videoPreload).toEqual([]);

    for (let i = 0; i < 10 && h.view(0).phase !== "answer"; i++) if (!h.wakeNext()) h.act(0, { type: "ready" });
    const answer = h.view(1);
    expect(answer.phase).toBe("answer");
    expect(answer.video).toMatchObject({ play: { segmentId: "question" }, hold: { momentId: "wait" }, data: null });
    // Frame 0 was 6.5 s before answers opened, so every client lands on the hold.
    expect(answer.video!.startedAt).toBe(answer.blockStartedAt! - 6500);
    // The reveal scene is never preloaded: it carries the votes.
    expect(answer.videoPreload).toEqual([]);
    expect(quizor.video!.directives(answer)).toEqual([answer.video]);

    h.act(0, { type: "answer", questionId: "q", answers: { pick: "b" } });
    h.act(1, { type: "answer", questionId: "q", answers: { pick: "b" } });
    h.act(2, { type: "answer", questionId: "q", answers: { pick: "c" } });
    for (let i = 0; i < 5 && h.view(0).phase !== "reveal"; i++) h.wakeNext();
    const reveal = h.view(0);
    expect(reveal.phase).toBe("reveal");
    expect(reveal.video).toMatchObject({ play: { segmentId: "result" } });
    expect(reveal.video!.data!.participants).toEqual({
      "card-b": { votes: 2, rank: 1, pickedBy: ["seat-0", "seat-1"] },
      "card-c": { votes: 1, rank: 2, pickedBy: ["seat-2"] },
      "card-a": { votes: 0, rank: 3, pickedBy: [] },
    });
    expect(reveal.players.find((p) => p.seat === 0)?.delta).toBe(100);
  });

  it("hides who picked what without showAnswers and clears video on pause", () => {
    const h = harness(rules({ defaults: { judge: "poll", showAnswers: false, timers: { preloadSeconds: 0 } } }));
    for (let i = 0; i < 10 && h.view(0).phase !== "answer"; i++) if (!h.wakeNext()) h.act(0, { type: "ready" });
    for (const seat of [0, 1, 2]) h.act(seat, { type: "answer", questionId: "q", answers: { pick: "a" } });
    for (let i = 0; i < 5 && h.view(0).phase !== "reveal"; i++) h.wakeNext();
    const card = h.view(0).video!.data!.participants!["card-a"];
    expect(card).toEqual({ votes: 3, rank: 1 });
  });

  it("checks scenes, moments, cards and data against the snapshot", () => {
    const catalog = createCatalog([quizor]);
    const base = presetDocument(quizor);
    const broken = rules();
    broken.rounds[0].questions[0].blocks[0].hold = "nope";
    broken.rounds[0].questions[0].fields[0] = { ...broken.rounds[0].questions[0].fields[0], options: [...options.slice(0, 2), { ...options[2], card: "card-z" }] } as never;
    broken.rounds[0].questions[0].reveal[0].data = "none";
    broken.rounds[0].intro.push({ type: "scene", play: { segmentId: "missing" } });
    const result = validateConfig(catalog, { ...base, rules: broken }, { videoSnapshots: { [SNAPSHOT]: summary } });
    expect(result.ok).toBe(false);
    const codes = result.issues.map((i) => `${i.code}@${i.path}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        "video_moment@rules.rounds[0].questions[0].blocks[0].hold",
        "video_card@rules.rounds[0].questions[0].fields[0].options[2].card",
        "video_data@rules.rounds[0].questions[0].reveal[0].data",
        "video_scene@rules.rounds[0].intro[1].play",
      ]),
    );
    const ok = validateConfig(catalog, { ...base, rules: rules() }, { videoSnapshots: { [SNAPSHOT]: summary } });
    expect(ok.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(validateConfig(catalog, { ...base, rules: rules() }, { videoSnapshots: {} }).issues.map((i) => i.code)).toContain("video_snapshot");
  });

  it("refuses self pacing and scenes without a snapshot", () => {
    const r = rules({ defaults: { pacing: "self", judge: "poll" } });
    const codes = checkRules(r).map((i) => i.code);
    expect(codes).toContain("video_pacing");
    const { video: _video, ...rest } = rules();
    expect(checkRules(rulesSchema.parse(rest)).map((i) => i.code)).toContain("video_snapshot");
  });
});
