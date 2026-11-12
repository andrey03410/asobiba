/**
 * Games the site can draw. A new game adds its definition (for local
 * validation) and its React client (board, seat icon, animation CSS) here.
 */
import { jinchi } from "@asobiba/game-jinchi";
import { jinchiClient } from "@asobiba/game-jinchi/client";
import { russkoePole } from "@asobiba/game-russkoe-pole";
import { russkoePoleClient } from "@asobiba/game-russkoe-pole/client";
import { quizor } from "@asobiba/game-quizor";
import { quizorClient } from "@asobiba/game-quizor/client";
import { ticTacToe } from "@asobiba/game-tic-tac-toe";
import { ticTacToeClient } from "@asobiba/game-tic-tac-toe/client";
import { type AnyGame, type BoardProps, createCatalog, type GameClient, type SeatIconProps } from "@asobiba/sdk";
import type { ComponentType } from "react";

export type WebGameClient = GameClient<ComponentType<BoardProps>, ComponentType<SeatIconProps>>;

const definitions: AnyGame[] = [ticTacToe, jinchi, russkoePole, quizor];

export const gameClients: Record<string, WebGameClient> = {
  [ticTacToeClient.gameId]: ticTacToeClient,
  [jinchiClient.gameId]: jinchiClient,
  [russkoePoleClient.gameId]: russkoePoleClient,
  [quizorClient.gameId]: quizorClient,
};

/** Catalog for local validation in the browser; the server validates again. */
export const catalog = createCatalog(definitions);

export function gameClient(gameId: string): WebGameClient | undefined {
  return gameClients[gameId];
}

/** Animation CSS of every game, injected once in the app root. */
export const gamesCss = Object.values(gameClients)
  .map((c) => c.css)
  .join("\n");
