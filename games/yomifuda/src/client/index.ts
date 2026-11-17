import { createRng, isActionError, type BoardProps, type ConfigDocument, type GameClient, type MatchView, type SeatIconProps } from '@asobiba/sdk';
import type { ComponentType } from 'react';
import { demoRules, yomifuda } from '../index';
import { YomifudaBoard, YomifudaSeatIcon } from './Board';
import { YOMIFUDA_CSS } from './css';
/** Always independent educational data. Even reading config.rules here would leak deck identity in previews. */
export function previewMatch(_config: ConfigDocument, moment: 'start' | 'end', seed: number): MatchView {
  const rules = demoRules();
  const ctx = { rules, seats: rules.players, rng: createRng(seed), now: 0 };
  let state = yomifuda.setup({ ...ctx, round: 1, firstSeat: 0 });
  if (moment === 'end') for (let n = 0; n < 100 && !yomifuda.roundResult(state); n++) {
    const seats = yomifuda.currentSeats(state);
    if (seats.length) {
      const seat = seats[0]; const action = yomifuda.legalActions(state, seat, ctx)[0];
      const next = yomifuda.applyAction(state, seat, action, ctx);
      if (isActionError(next)) throw new Error('Demo action rejected');
      state = next;
    } else {
      const at = yomifuda.nextWakeAt?.(state);
      if (at == null || !yomifuda.wake) break;
      ctx.now = at; state = yomifuda.wake(state, ctx);
    }
  }
  const view = yomifuda.view(state, null), result = yomifuda.roundResult(state), scores = view.players.map(p => p.score);
  return { phase: result ? 'finished' : 'playing', round: 1, rounds: 1, scores, seats: rules.players, currentSeats: yomifuda.currentSeats(state), turnDeadline: null, intermissionUntil: null, lastRound: result, roundResults: result ? [result] : [], result: result ? { winners: result.winners, draw: result.draw, scores } : null, game: view };
}
export const yomifudaClient: GameClient<ComponentType<BoardProps>, ComponentType<SeatIconProps>> = { gameId: 'yomifuda', stageHud: 'board', Board: YomifudaBoard, SeatIcon: YomifudaSeatIcon, css: YOMIFUDA_CSS, previewMatch };
export { YomifudaBoard, YomifudaSeatIcon, YOMIFUDA_CSS };
