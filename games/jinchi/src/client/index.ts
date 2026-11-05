import { createRng, Match } from '@asobiba/sdk';
import type { BoardProps, ConfigDocument, GameClient, MatchView, SeatIconProps } from '@asobiba/sdk';
import type { ComponentType } from 'react';
import { findPlacements, jinchi } from '../game';
import type { JinchiView } from '../game';
import { JinchiBoard, JinchiSeatIcon } from './Board';
import { JINCHI_CSS } from './css';
import { JINCHI_EDITOR_CSS } from './editor-css';

export { JinchiBoard, JinchiSeatIcon } from './Board';
export { MapViewport, MapArtwork } from './MapViewport';
export type { MapViewportProps } from './MapViewport';
export { MapEditor } from './MapEditor';
export { JINCHI_CSS } from './css';

/** Seeded sample positions use the engine, including manual dice rolls. */
export function previewMatch(config: ConfigDocument, moment: 'start' | 'end', seed: number): MatchView {
  const started = performance.now();
  const budget = jinchi.simulationBudget?.(config.rules as never);
  const seats = jinchi.seats(config.rules as never).max;
  const quiet: ConfigDocument = { ...config, timer: { turnSeconds: 0, onTimeout: 'random' } };
  const match = Match.start({ game: jinchi, config: quiet, seats, seed, startedAt: 0 });
  if (moment === 'end') {
    const rng = createRng(seed * 31 + 7);
    // Share the game computation budget; a large map may show an intermediate position.
    const maxActions = Math.min(1800, budget?.maxTotalActions ?? 1800);
    for (let turn = 1; turn <= maxActions; turn++) {
      if (performance.now() - started >= (budget?.maxDurationMs ?? 1000)) break;
      const summary = match.view(null);
      if (summary.phase !== 'playing') break;
      const seat = summary.currentSeats[0];
      if (seat === undefined) break;
      const view = match.view(seat).game as JinchiView;
      if (!view.dice) {
        if (!match.dispatch(seat, { type: 'roll' }, turn).ok) break;
      } else {
        const placements = findPlacements(view, seat);
        if (!placements.length || !match.dispatch(seat, rng.pick(placements), turn).ok) break;
      }
    }
  }
  return match.view(null);
}

export const jinchiClient: GameClient<ComponentType<BoardProps>, ComponentType<SeatIconProps>> = {
  gameId: 'jinchi',
  Board: JinchiBoard,
  SeatIcon: JinchiSeatIcon,
  css: JINCHI_CSS + JINCHI_EDITOR_CSS,
  previewMatch,
};
