import type { ConfigDocument } from "./config";
import { type AnyGame, isActionError, type Seat } from "./game";
import { createRng } from "./rng";

export interface SimulationIssue {
  code: "never-ends" | "always-draw" | "first-seat-dominates" | "illegal-legal-action" | "stuck";
  message: string;
}

export interface SimulationReport {
  rounds: number;
  finished: number;
  unfinished: number;
  draws: number;
  /** Wins per seat; seat 0 always starts, so winsBySeat[0] measures the first-move advantage. */
  winsBySeat: number[];
  averageActions: number;
  maxActions: number;
  issues: SimulationIssue[];
}

export interface SimulateOptions {
  rounds?: number;
  seed?: number;
  /** Turn games: actions per round before the round counts as never-ending. */
  maxActions?: number;
}

/**
 * Plays independent rounds with random legal actions. Random play is not
 * strategy, so the report is a smoke test: does the round end, is it all draws,
 * does the first seat always win.
 */
export function simulate(game: AnyGame, config: ConfigDocument, options: SimulateOptions = {}): SimulationReport {
  const rounds = Math.max(1, Math.min(options.rounds ?? 50, 500));
  const seats = game.seats(config.rules).max;
  const maxActions = options.maxActions ?? 2000;
  const winsBySeat = Array.from({ length: seats }, () => 0);
  const issues: SimulationIssue[] = [];
  let finished = 0;
  let draws = 0;
  let totalActions = 0;
  let longest = 0;
  let stuck = 0;
  let illegal = 0;

  for (let r = 0; r < rounds; r++) {
    const rng = createRng((options.seed ?? 1) * 7919 + r);
    const ctx = { rules: config.rules, seats, rng, now: 0 };
    let state = game.setup({ ...ctx, round: 1, firstSeat: 0 });
    let actions = 0;
    let done = false;
    let tick = 0;
    const step = 1000 / (game.tickRate ?? 20);
    while (actions < maxActions) {
      const rr = game.roundResult(state);
      if (rr) {
        finished++;
        if (rr.draw) draws++;
        else for (const w of rr.winners) winsBySeat[w] = (winsBySeat[w] ?? 0) + 1;
        done = true;
        break;
      }
      if (game.kind === "realtime") {
        for (let seat = 0; seat < seats; seat++) {
          if (rng.next() < 0.3) {
            const legal = game.legalActions(state, seat, ctx);
            if (legal.length > 0) {
              const next = game.applyAction(state, seat, rng.pick(legal), ctx);
              if (!isActionError(next)) state = next;
            }
          }
        }
        state = game.tick ? game.tick(state, { ...ctx, now: tick * step, tick, dtMs: step }) : state;
        tick++;
        actions++;
        continue;
      }
      const seat: Seat | undefined = game.currentSeats(state)[0];
      if (seat === undefined) {
        stuck++;
        break;
      }
      const legal = game.legalActions(state, seat, ctx);
      if (legal.length === 0) {
        if (!game.passTurn) {
          stuck++;
          break;
        }
        state = game.passTurn(state, seat, ctx);
      } else {
        const next = game.applyAction(state, seat, rng.pick(legal), ctx);
        if (isActionError(next)) {
          illegal++;
          break;
        }
        state = next;
      }
      actions++;
    }
    totalActions += actions;
    longest = Math.max(longest, actions);
    void done;
  }

  const unfinished = rounds - finished;
  if (illegal > 0) {
    issues.push({ code: "illegal-legal-action", message: `Игра отвергла ход из своего же списка допустимых в ${illegal} раундах — это ошибка игры, сообщите разработчику` });
  }
  if (stuck > 0) {
    issues.push({ code: "stuck", message: `В ${stuck} раундах у игрока не было ходов, а раунд не закончился` });
  }
  if (unfinished - stuck - illegal > 0) {
    issues.push({ code: "never-ends", message: `${unfinished - stuck - illegal} из ${rounds} раундов не закончились за ${maxActions} действий` });
  }
  if (finished >= 10 && draws / finished >= 0.95) {
    issues.push({ code: "always-draw", message: `При случайной игре ${Math.round((draws / finished) * 100)}% раундов — ничьи: победить слишком трудно` });
  }
  const decisive = finished - draws;
  if (decisive >= 10 && (winsBySeat[0] ?? 0) / decisive >= 0.9) {
    issues.push({ code: "first-seat-dominates", message: `Первый игрок выигрывает ${Math.round(((winsBySeat[0] ?? 0) / decisive) * 100)}% результативных раундов` });
  }

  return {
    rounds,
    finished,
    unfinished,
    draws,
    winsBySeat,
    averageActions: Math.round((totalActions / rounds) * 10) / 10,
    maxActions: longest,
    issues,
  };
}
