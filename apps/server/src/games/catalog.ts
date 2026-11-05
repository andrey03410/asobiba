import type { BoardProps, GameClient, SeatIconProps } from "@asobiba/sdk";
import { createCatalog } from "@asobiba/sdk";
import { jinchi } from "@asobiba/game-jinchi";
import { jinchiClient } from "@asobiba/game-jinchi/client";
import { ticTacToe } from "@asobiba/game-tic-tac-toe";
import { ticTacToeClient } from "@asobiba/game-tic-tac-toe/client";
import type { ComponentType } from "react";

/** Every game the site offers. Adding a game = adding it here and to apps/web/src/games.ts. */
export const catalog = createCatalog([ticTacToe, jinchi]);

export type ReactGameClient = GameClient<ComponentType<BoardProps>, ComponentType<SeatIconProps>>;

const clients = new Map<string, ReactGameClient>([[ticTacToeClient.gameId, ticTacToeClient], [jinchiClient.gameId, jinchiClient]]);

export function gameClient(gameId: string): ReactGameClient | undefined {
  return clients.get(gameId);
}
