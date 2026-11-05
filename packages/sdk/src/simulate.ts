import type { ConfigDocument } from "./config";
import { type AnyGame, isActionError, type Seat } from "./game";
import { createRng } from "./rng";

export interface SimulationIssue {
  code: "never-ends" | "always-draw" | "first-seat-dominates" | "illegal-legal-action" | "stuck" | "budget-exceeded";
  message: string;
}

export interface SimulationReport {
  /** Rounds actually started, including an interrupted partial round. */
  rounds: number;
  /** Normalized requested count, before applying the computation budget. */
  requestedRounds: number;
  /** Requested rounds that were never started because of the computation budget. */
  skippedRounds: number;
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
  /** Total simulation steps across all rounds; may lower, but never raise, the game's budget. */
  maxTotalActions?: number;
}

function totalActionLimit(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : Infinity;
}

/**
 * Plays independent rounds with random legal actions. Random play is not
 * strategy, so the report is a smoke test: does the round end, is it all draws,
 * does the first seat always win.
 */
export function simulate(game: AnyGame, config: ConfigDocument, options: SimulateOptions = {}): SimulationReport {
  const requestedRounds = Math.max(1, Math.min(Math.floor(Number.isNaN(options.rounds) ? 50 : options.rounds ?? 50), 500));
  const maxTotalActions = Math.min(totalActionLimit(options.maxTotalActions), totalActionLimit(game.simulationBudget?.(config.rules).maxTotalActions));
  let rounds = 0;
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
  let neverEnds = 0;
  let budgetExceeded = false;

  for (let r = 0; r < requestedRounds; r++) {
    if (totalActions >= maxTotalActions) {
      budgetExceeded = true;
      break;
    }
    rounds++;
    const rng = createRng((options.seed ?? 1) * 7919 + r);
    const ctx = { rules: config.rules, seats, rng, now: 0 };
    let state = game.setup({ ...ctx, round: 1, firstSeat: 0 });
    let actions = 0;
    let tick = 0;
    const step = 1000 / (game.tickRate ?? 20);
    while (true) {
      const rr = game.roundResult(state);
      if (rr) {
        finished++;
        if (rr.draw) draws++;
        else for (const w of rr.winners) winsBySeat[w] = (winsBySeat[w] ?? 0) + 1;
        break;
      }
      // Check outcomes before either limit so the final allowed action can finish a round.
      if (!(actions < maxActions)) {
        neverEnds++;
        break;
      }
      if (totalActions + actions >= maxTotalActions) {
        budgetExceeded = true;
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
  }

  const unfinished = rounds - finished;
  const skippedRounds = requestedRounds - rounds;
  if (illegal > 0) {
    issues.push({ code: "illegal-legal-action", message: `Игра отвергла ход из своего же списка допустимых в ${illegal} раундах — это ошибка игры, сообщите разработчику` });
  }
  if (stuck > 0) {
    issues.push({ code: "stuck", message: `В ${stuck} раундах у игрока не было ходов, а раунд не закончился` });
  }
  if (neverEnds > 0) {
    issues.push({ code: "never-ends", message: `${neverEnds} из ${rounds} раундов не закончились за ${maxActions} действий` });
  }
  if (budgetExceeded) {
    issues.push({ code: "budget-exceeded", message: `Достигнут общий лимит симуляции: ${maxTotalActions} действий. Начато ${rounds} из ${requestedRounds} раундов; остальные не проверены полностью` });
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
    requestedRounds,
    skippedRounds,
    finished,
    unfinished,
    draws,
    winsBySeat,
    averageActions: Math.round((totalActions / rounds) * 10) / 10,
    maxActions: longest,
    issues,
  };
}
