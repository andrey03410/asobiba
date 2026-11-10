import type { ConfigDocument } from "./config";
import type { Seat } from "./game";
import type { MatchView } from "./match";

/**
 * Props every game board component receives. Kept free of React types so the
 * SDK has no UI dependency; game client packages type `Board` with React.
 */
export interface BoardProps {
  match: MatchView;
  config: ConfigDocument;
  /** The viewer's seat, or null for spectators. */
  seat: Seat | null;
  /** Resolves `ast_…` to a URL (a site path or a data: URI in previews). */
  assetUrl: (assetId: string) => string;
  onAction?: (action: unknown) => void;
  /** Server-side previews: no animations, no interaction. */
  staticRender?: boolean;
  /** Display names by seat for compact in-board HUDs. */
  playerNames?: string[];
  /** Server clock offset; clients use it for turn countdowns. */
  clockOffset?: number;
  /** Remaining turn time, for clients that supply a countdown directly. */
  turnRemainingMs?: number | null;
  /**
   * The board is on the match stage: the lobby is hidden and the board's container
   * fills the screen below the stage bar. The root must stretch to 100% width and
   * height and lay itself out for both landscape and portrait.
   */
  stage?: boolean;
  /**
   * Fullscreen of the whole stage, owned by the site. A board with its own
   * fullscreen button calls `toggle` instead of requesting fullscreen itself.
   */
  fullscreen?: StageFullscreen;
  /**
   * The board is playing an animation whose outcome is already in `match`
   * (a wheel still spinning). While held, the stage keeps its turn badge and
   * result card as they were, so the HUD does not reveal the outcome early.
   * Call with `false` when the animation is over and on unmount.
   */
  onHold?: (hold: boolean) => void;
}

export interface StageFullscreen {
  /** The stage is in browser fullscreen right now. */
  active: boolean;
  /** The browser supports element fullscreen (iPhone Safari does not). */
  available: boolean;
  toggle(): void;
}

export interface SeatIconProps {
  config: ConfigDocument;
  seat: Seat;
  assetUrl: (assetId: string) => string;
  size?: number;
}

export interface GameClient<Component = unknown, Icon = unknown> {
  gameId: string;
  Board: Component;
  SeatIcon: Icon;
  /** CSS for animations; inject once per page. */
  css: string;
  /** Sample position for previews: `start` — empty board, `end` — a sampled random round, possibly intermediate when the game computation budget is reached. Check phase/lastRound before describing it as finished. */
  previewMatch(config: ConfigDocument, moment: "start" | "end", seed: number): MatchView;
}
