import {
  createRng,
  isActionError,
  type BoardProps,
  type ConfigDocument,
  type GameClient,
  type MatchView,
  type PreviewTarget,
  type SeatIconProps,
} from "@asobiba/sdk";
import type { ComponentType } from "react";
import { quizor, type QuizorState } from "../game";
import { resolveQuestion, type QuizorRules } from "../rules";
import { QuizorBoard, QuizorSeatIcon } from "./Board";
import { QUIZOR_CSS } from "./css";

function matchView(state: QuizorState, seats: number): MatchView {
  const result = quizor.roundResult(state);
  return {
    phase: result ? "finished" : "playing",
    round: 1,
    rounds: 1,
    scores: state.players.map((p) => p.score),
    seats,
    currentSeats: result ? [] : quizor.currentSeats(state),
    turnDeadline: null,
    intermissionUntil: null,
    lastRound: result,
    roundResults: result ? [result] : [],
    result: result
      ? {
          winners: result.winners,
          draw: result.draw,
          scores: state.players.map((p) => p.score),
        }
      : null,
    game: quizor.view(state, null),
  };
}

export function previewMatch(
  config: ConfigDocument,
  moment: "start" | "end",
  seed: number,
): MatchView {
  const rules = config.rules as QuizorRules;
  const seats = Math.max(rules.players.min, Math.min(rules.players.max, 4));
  if (rules.rounds.every((r) => r.questions.length === 0)) {
    return {
      phase: "playing",
      round: 1,
      rounds: 1,
      scores: Array(seats).fill(0),
      seats,
      currentSeats: [],
      turnDeadline: null,
      intermissionUntil: null,
      lastRound: null,
      roundResults: [],
      result: null,
      game: {
        phase: "intro",
        title: config.title,
        prompt: "Вопросы откроются во время партии",
        blocks: [],
        board: [],
        players: Array.from({ length: seats }, (_, seat) => ({
          seat,
          score: 0,
        })),
      },
    };
  }
  const ctx = { rules, seats, rng: createRng(seed), now: 0 };
  let state = quizor.setup({ ...ctx, round: 1, firstSeat: 0 });
  if (moment === "end")
    for (let n = 0; n < 5000 && !quizor.roundResult(state); n++) {
      const candidates = quizor
        .currentSeats(state)
        .flatMap((seat) =>
          quizor
            .legalActions(state, seat, ctx)
            .map((action) => ({ seat, action })),
        );
      if (candidates.length) {
        const { seat, action } = ctx.rng.pick(candidates);
        const next = quizor.applyAction(state, seat, action, ctx);
        if (isActionError(next)) break;
        state = next;
      } else {
        const wake = quizor.nextWakeAt?.(state);
        if (wake === null || wake === undefined || !quizor.wake) break;
        ctx.now = Math.max(ctx.now + 1, wake);
        state = quizor.wake(state, ctx);
      }
    }
  return matchView(state, seats);
}

export function previewTarget(
  config: ConfigDocument,
  target: PreviewTarget,
  seed: number,
): MatchView {
  const rules = config.rules as QuizorRules;
  const seats = Math.max(rules.players.min, Math.min(rules.players.max, 4));
  const state = quizor.setup({
    rules,
    seats,
    rng: createRng(seed),
    now: 0,
    round: 1,
    firstSeat: 0,
  });
  if (target.kind === "question") {
    let resolved;
    try {
      resolved = resolveQuestion(rules, target.id);
    } catch {
      throw Object.assign(new Error(`Вопрос ${target.id} не найден`), {
        code: "target_not_found",
      });
    }
    state.active = resolved;
    state.phase = "answer";
    state.blockIndex = resolved.question.blocks.length - 1;
    state.blockStartedAt = 0;
    state.answerOpenedAt = 0;
    state.eligible = state.players.map((_, i) => i);
    state.roundId = resolved.roundId;
    state.title =
      rules.rounds.find((r) => r.id === resolved.roundId)?.title ?? "Вопрос";
  } else {
    const index = rules.rounds.findIndex((r) => r.id === target.id);
    if (index < 0)
      throw Object.assign(new Error(`Раунд ${target.id} не найден`), {
        code: "target_not_found",
      });
    const round = rules.rounds[index];
    state.round = index;
    state.roundId = round.id;
    state.title = round.title;
    state.phase =
      target.kind === "round" && round.format === "board" ? "board" : "intro";
    state.active = null;
    state.queue = round.questions.map((q) => q.id);
    state.remaining = [...state.queue];
    state.played = [];
  }
  return matchView(state, seats);
}

export const quizorClient: GameClient<
  ComponentType<BoardProps>,
  ComponentType<SeatIconProps>
> = {
  gameId: "quizor",
  Board: QuizorBoard,
  SeatIcon: QuizorSeatIcon,
  css: QUIZOR_CSS,
  previewMatch,
  previewTarget,
};
export { QuizorBoard, QuizorSeatIcon, QUIZOR_CSS };
