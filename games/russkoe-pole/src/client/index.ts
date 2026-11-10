import { type ConfigDocument, createRng, type GameClient, Match, type MatchView } from "@asobiba/sdk";
import type { ComponentType } from "react";
import type { BoardProps, SeatIconProps } from "@asobiba/sdk";
import { type PoleAction, type PoleView, russkoePole } from "../game";
import { RusskoePoleBoard, RusskoePoleSeatIcon } from "./Board";
import { RUSSKOE_POLE_CSS } from "./css";

export function previewMatch(config: ConfigDocument, moment: "start" | "end", seed: number): MatchView {
  const span = russkoePole.seats(config.rules as never);
  const seats = span.min;
  const quiet: ConfigDocument = { ...config, timer: { turnSeconds: 0, onTimeout: "skip" } };
  const match = Match.start({ game: russkoePole, config: quiet, seats, seed, startedAt: 0 });
  if (moment === "end") {
    const rng = createRng(seed * 31 + 7);
    for (let step = 0; step < 80 && match.view(null).phase === "playing"; step++) {
      const view = match.view(null);
      const seat = view.currentSeats[0];
      if (seat === undefined) break;
      const game = view.game as PoleView;
      const action = previewAction(game);
      if (!action) break;
      const result = match.dispatch(seat, action, step + 1);
      if (!result.ok) break;
      void rng;
    }
  }
  return match.view(null);
}

function previewAction(view: PoleView): PoleAction | null {
  if (view.phase === "spin" || view.phase === "wheel") return { type: "spin" };
  if (view.phase === "guess") {
    const letter = view.alphabet.find((item) => !view.called.includes(item));
    return letter ? { type: "letter", letter } : null;
  }
  if (view.phase === "prize") return { type: "prize", choice: "cash" };
  if (view.phase === "detector") return { type: "detector", buy: false };
  if (view.phase === "roulette") return { type: "roulette", bullets: 1 };
  if (view.phase === "math") return { type: "math", value: 0 };
  if (view.phase === "chests") return { type: "chest", index: 0 };
  if (view.phase === "offer") return { type: "super", accept: false };
  if (view.phase === "letters" || view.phase === "sk-letters") return { type: "letters", letters: view.alphabet.slice(0, 1) };
  if (view.phase === "sk-sabotage") return { type: "sabotage", kind: "none" };
  return null;
}

export const russkoePoleClient: GameClient<ComponentType<BoardProps>, ComponentType<SeatIconProps>> = {
  gameId: russkoePole.id,
  Board: RusskoePoleBoard,
  SeatIcon: RusskoePoleSeatIcon,
  css: RUSSKOE_POLE_CSS,
  previewMatch,
};
