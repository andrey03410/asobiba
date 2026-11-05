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
  /** Sample position for previews: `start` — empty board, `end` — a finished random round. */
  previewMatch(config: ConfigDocument, moment: "start" | "end", seed: number): MatchView;
}
