import { describe, expect, it } from "vitest";
import { Match, PlayerHandles, presetDocument } from "@asobiba/sdk";
import { quizor, type QuizorView } from "./game";
import { prepareQuizorPlayerAction, quizorPlayerView, quizorPlayerWireView } from "./player";

function classicQuestion() {
  const config = presetDocument(quizor, quizor.presets.find(preset => preset.id === "classic"));
  const match = Match.start({ game: quizor, config, seats: 2, startedAt: 100, seed: 42 });
  for (let i = 0; i < 20 && !(match.view(0).game as QuizorView).canAnswer; i++) match.advance(match.nextWakeAt()!);
  return match;
}

describe("opaque Quizor seat identities", () => {
  it("classic's question ID and arbitrary identifiers cannot serve as the answer", () => {
    const match = classicQuestion();
    const human = match.view(0);
    const quiz = human.game as QuizorView;
    expect(quiz.questionId).toBe("earth");
    const ai = match.projectPlayerView(0, human, match.checkpointAt) as QuizorView;
    expect(ai.questionId).not.toBe(quiz.questionId);
    expect(ai.fields[0].id).not.toBe(quiz.fields[0].id);
    expect(match.projectPlayerView(0, human, match.checkpointAt)).toEqual(ai);
    const action = { type: "answer", questionId: ai.questionId, answers: { [ai.fields[0].id]: "Земля" } };
    expect(match.dispatchPlayer(0, { ...action, questionId: "earth" }, match.checkpointAt).ok).toBe(false);
    expect(match.dispatchPlayer(0, { ...action, answers: { answer: "Земля" } }, match.checkpointAt).ok).toBe(false);
    expect(match.dispatchPlayer(0, action, match.checkpointAt).ok).toBe(true);
    expect(match.record().log.at(-1)?.action).toMatchObject({ questionId: "earth", answers: { answer: "Земля" } });
  });

  it("round-trips independently authored IDs in paired and ordered answers", () => {
    const base = classicQuestion().view(0).game as QuizorView;
    const pair = {id: "pairs-raw", label: "Подберите пары", type: "match" as const, required: true,
      left: [{id: "left-raw", text: "А", card: "unshown-left-card"}], right: [{id: "right-raw", text: "Б", card: "unshown-right-card"}]};
    const order = {id: "order-raw", label: "Расставьте", type: "order" as const, required: true, items: [{id: "item-raw", text: "В"}]};
    const answers = { "pairs-raw": { "left-raw": "right-raw" }, "order-raw": ["item-raw"] };
    const source = { ...base, fields: [pair, order], ownAnswer: answers };
    const handles = new PlayerHandles();
    const projected = quizorPlayerView(source, 0, 100, handles);
    expect(JSON.stringify(projected)).not.toContain("-raw");
    expect(JSON.stringify(quizorPlayerWireView(projected))).not.toContain("unshown-");
    expect(prepareQuizorPlayerAction({ type: "draft", answers: projected.ownAnswer }, source, 100, handles)).toEqual({ type: "draft", answers });
    expect(prepareQuizorPlayerAction({ type: "draft", answers }, source, 100, handles)).toBeNull();
    const foreign = quizorPlayerView(source, 1, 100, new PlayerHandles());
    expect(prepareQuizorPlayerAction({ type: "draft", answers: foreign.ownAnswer }, source, 100, handles)).toBeNull();
  });

  it("redacts board, vote and frame-only answer identifiers from state and action forms", () => {
    const human = classicQuestion().view(0).game as QuizorView;
    const frame = { id: "hidden-field", type: "choice" as const, label: "Выберите", required: true, pick: "frame" as const,
      options: [{ id: "hidden-solution", text: "hidden-label", card: "hidden-card", asset: "ast_hiddenasset" }] };
    const source = { ...human, fields: [frame], board: [{ questionId: "hidden-tomorrow", theme: "Тема", value: 10, played: false }],
      appeal: { questionId: "hidden-question", author: 1, seat: 1, points: 0, previous: 10, comment:"", votes:{ "0": true,"2":false }, deadline: 2000 } };
    const inner = quizorPlayerView(source, 0, 100, new PlayerHandles());
    const wire = quizorPlayerWireView(inner) as QuizorView;
    const exposed = JSON.stringify({ wire, forms: quizor.playerActions(wire, 0) });
    expect(exposed).not.toContain("hidden-");
    expect(exposed).not.toContain("ast_hiddenasset");
    expect(wire.appeal).toMatchObject({voteCount: 2, ownVote: true});
    expect(wire.appeal).not.toHaveProperty("votes");
    expect(inner.fields[0].options?.[0].id).not.toBe("hidden-solution");
    expect(exposed).not.toContain(inner.fields[0].options?.[0].id);
  });
});
