import type { PoleRules } from "./rules";

const HIDDEN = "секрет";

/** Answers leave the copy that lobbies show to players. The match keeps the original. */
export function presentRules(rules: PoleRules): PoleRules {
  return {
    ...rules,
    words: { ...rules.words, custom: rules.words.custom.map((word) => ({ ...word, answer: HIDDEN })) },
    super: {
      ...rules.super,
      puzzles: rules.super.puzzles.map((puzzle) => ({ words: puzzle.words.map((word) => ({ ...word, answer: HIDDEN })) })),
    },
  };
}
