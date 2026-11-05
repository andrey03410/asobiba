import { type ConfigDocument, createRng, type GameClient, Match, type MatchView } from "@asobiba/sdk";
import type { ComponentType } from "react";
import type { BoardProps, SeatIconProps } from "@asobiba/sdk";
import { type TttAction, type TttView, ticTacToe } from "../game";
import { TicTacToeBoard, TicTacToeSeatIcon } from "./Board";
import { TIC_TAC_TOE_CSS } from "./css";

export { TicTacToeBoard, TicTacToeSeatIcon } from "./Board";
export { TIC_TAC_TOE_CSS } from "./css";
export { PieceShape } from "./pieces";

/** A position for previews: an empty board, or the end of a random round. */
export function previewMatch(config: ConfigDocument, moment: "start" | "end", seed: number): MatchView {
  const seats = ticTacToe.seats(config.rules as never).max;
  const quiet: ConfigDocument = { ...config, timer: { turnSeconds: 0, onTimeout: "random" } };
  const match = Match.start({ game: ticTacToe, config: quiet, seats, seed, startedAt: 0 });
  if (moment === "end") {
    const rng = createRng(seed * 31 + 7);
    for (let t = 1; t < 2000; t++) {
      const v = match.view(null);
      if (v.phase !== "playing") break;
      const seat = v.currentSeats[0];
      if (seat === undefined) break;
      const game = match.view(seat).game as TttView;
      if (game.legal.length === 0) break;
      const index = rng.pick(game.legal);
      const action: TttAction =
        game.placement === "gravity" ? { type: "drop", col: index % game.width } : { type: "place", row: Math.floor(index / game.width), col: index % game.width };
      match.dispatch(seat, action, t);
    }
  }
  return match.view(null);
}

export const ticTacToeClient: GameClient<ComponentType<BoardProps>, ComponentType<SeatIconProps>> = {
  gameId: ticTacToe.id,
  Board: TicTacToeBoard,
  SeatIcon: TicTacToeSeatIcon,
  css: TIC_TAC_TOE_CSS,
  previewMatch,
};
