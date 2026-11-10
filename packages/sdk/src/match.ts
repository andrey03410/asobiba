import type { ConfigDocument } from "./config";
import { type AnyGame, type GameContext, isActionError, type RoundResult, type Seat } from "./game";
import { createRng, type Rng } from "./rng";

/** Pause between rounds so players can see how the round ended. */
export const INTERMISSION_MS = 3000;
const MAX_EVENTS_PER_ADVANCE = 100_000;

export interface MatchLogEntry {
  at: number;
  seat: Seat;
  action: unknown;
}

/** Everything needed to rebuild a match: config + this record. */
export interface MatchRecord {
  seed: number;
  startedAt: number;
  seats: number;
  log: MatchLogEntry[];
}

export type MatchPhase = "playing" | "intermission" | "finished";

export interface MatchResult {
  /** Seats with the most round wins. More than one means a shared result. */
  winners: Seat[];
  draw: boolean;
  scores: number[];
}

export interface MatchView<PV = unknown> {
  phase: MatchPhase;
  round: number;
  rounds: number;
  scores: number[];
  seats: number;
  currentSeats: Seat[];
  turnDeadline: number | null;
  intermissionUntil: number | null;
  lastRound: RoundResult | null;
  roundResults: RoundResult[];
  result: MatchResult | null;
  game: PV;
}

export type DispatchResult = { ok: true } | { ok: false; error: { code: string; message: string } };

export interface StartOptions {
  game: AnyGame;
  config: ConfigDocument;
  seats: number;
  seed: number;
  startedAt: number;
}

/**
 * Runs a match of any game: rounds of a series, the pause between rounds, the
 * turn timer and fixed realtime steps. Only human actions are logged; timer
 * and tick events are derived from time, so replaying the log reproduces the
 * state exactly.
 */
export class Match {
  readonly game: AnyGame;
  readonly config: ConfigDocument;
  readonly seats: number;
  readonly seed: number;
  readonly startedAt: number;

  private readonly rng: Rng;
  private readonly log: MatchLogEntry[] = [];
  private state: unknown;
  private round = 1;
  private firstSeat: Seat = 0;
  private scores: number[];
  private roundResults: RoundResult[] = [];
  private phase: MatchPhase = "playing";
  private result: MatchResult | null = null;
  private turnDeadline: number | null = null;
  private turnKey = "";
  private intermissionUntil: number | null = null;
  private roundStartedAt: number;
  private ticks = 0;
  private clock: number;

  private constructor(options: StartOptions) {
    this.game = options.game;
    this.config = options.config;
    this.seats = options.seats;
    this.seed = options.seed;
    this.startedAt = options.startedAt;
    this.rng = createRng(options.seed);
    this.scores = Array.from({ length: options.seats }, () => 0);
    this.clock = options.startedAt;
    this.roundStartedAt = options.startedAt;
    this.state = this.game.setup({ ...this.ctx(options.startedAt), round: 1, firstSeat: 0 });
    this.resetTurnTimer(options.startedAt, true);
  }

  static start(options: StartOptions): Match {
    const { min, max } = options.game.seats(options.config.rules);
    if (options.seats < min || options.seats > max) {
      throw new Error(`Match.start: ${options.seats} seats, game needs ${min}-${max}`);
    }
    const match = new Match(options);
    match.settle(options.startedAt);
    return match;
  }

  /** Rebuilds a match from its record and advances it to `now`. */
  static restore(options: { game: AnyGame; config: ConfigDocument; record: MatchRecord; now: number }): Match {
    const { record } = options;
    const match = Match.start({ game: options.game, config: options.config, seats: record.seats, seed: record.seed, startedAt: record.startedAt });
    for (const entry of record.log) {
      const res = match.dispatch(entry.seat, entry.action, entry.at);
      if (!res.ok) throw new Error(`Match.restore: log entry rejected at ${entry.at}: ${res.error.code}`);
    }
    match.advance(options.now);
    return match;
  }

  get currentPhase(): MatchPhase {
    return this.phase;
  }

  get finalResult(): MatchResult | null {
    return this.result;
  }

  record(): MatchRecord {
    return { seed: this.seed, startedAt: this.startedAt, seats: this.seats, log: [...this.log] };
  }

  /** Applies a human action. Pending timer and round events up to `at` are processed first. */
  dispatch(seat: Seat, rawAction: unknown, at: number): DispatchResult {
    const time = Math.max(at, this.clock);
    this.advance(time);
    if (seat < 0 || seat >= this.seats || !Number.isInteger(seat)) return fail("bad_seat", "Нет такого места");
    if (this.phase === "finished") return fail("finished", "Партия закончена");
    if (this.phase === "intermission") return fail("intermission", "Пауза между раундами");
    const parsed = this.game.actionSchema.safeParse(rawAction);
    if (!parsed.success) return fail("bad_action", parsed.error.issues[0]?.message ?? "Неверное действие");
    if (this.game.kind === "turn" && !this.game.currentSeats(this.state).includes(seat)) {
      return fail("not_your_turn", "Сейчас не ваш ход");
    }
    const rngState = this.rng.state();
    const next = this.game.applyAction(this.state, seat, parsed.data, this.ctx(time));
    if (isActionError(next)) {
      // rejected actions are not logged, so they must not move the generator either
      this.rng.restore(rngState);
      return { ok: false, error: next.error };
    }
    this.state = next;
    this.log.push({ at: time, seat, action: parsed.data });
    this.afterChange(time);
    return { ok: true };
  }

  /** Processes timers, pauses and realtime steps up to `now`. Returns true if anything happened. */
  advance(now: number): boolean {
    let changed = false;
    for (let i = 0; i < MAX_EVENTS_PER_ADVANCE; i++) {
      const next = this.nextEvent();
      if (!next || next.at > now) break;
      next.run();
      changed = true;
    }
    this.clock = Math.max(this.clock, now);
    return changed;
  }

  /** When the server should call `advance` next, or null if nothing is scheduled. */
  nextWakeAt(): number | null {
    return this.nextEvent()?.at ?? null;
  }

  view(seat: Seat | null): MatchView {
    return {
      phase: this.phase,
      round: this.round,
      rounds: this.config.series.rounds,
      scores: [...this.scores],
      seats: this.seats,
      currentSeats: this.phase === "playing" ? this.game.currentSeats(this.state) : [],
      turnDeadline: this.turnDeadline,
      intermissionUntil: this.intermissionUntil,
      lastRound: this.roundResults.at(-1) ?? null,
      roundResults: [...this.roundResults],
      result: this.result,
      game: this.game.view(this.state, seat),
    };
  }

  private ctx(now: number): GameContext<unknown> {
    return { rules: this.config.rules, seats: this.seats, rng: this.rng, now };
  }

  private nextEvent(): { at: number; run: () => void } | null {
    if (this.phase === "intermission" && this.intermissionUntil !== null) {
      const at = this.intermissionUntil;
      return { at, run: () => this.nextRound(at) };
    }
    if (this.phase !== "playing") return null;
    const candidates: { at: number; run: () => void }[] = [];
    if (this.turnDeadline !== null) {
      const at = this.turnDeadline;
      candidates.push({ at, run: () => this.handleTimeout(at) });
    }
    if (this.game.kind === "realtime" && this.game.tick) {
      const step = 1000 / (this.game.tickRate ?? 20);
      const at = this.roundStartedAt + (this.ticks + 1) * step;
      candidates.push({ at, run: () => this.runTick(at, step) });
    }
    candidates.sort((a, b) => a.at - b.at);
    return candidates[0] ?? null;
  }

  private runTick(at: number, step: number) {
    const tick = this.game.tick;
    if (!tick) return;
    this.state = tick(this.state, { ...this.ctx(at), tick: this.ticks, dtMs: step });
    this.ticks += 1;
    this.afterChange(at);
  }

  private handleTimeout(at: number) {
    const seats = this.game.currentSeats(this.state);
    const seat = seats[0];
    if (seat === undefined) {
      this.turnDeadline = null;
      return;
    }
    const policy = this.game.timeoutPolicy ?? this.config.timer.onTimeout;
    if (policy === "lose") {
      const others = Array.from({ length: this.seats }, (_, i) => i).filter((s) => s !== seat);
      this.endRound({ winners: others, losers: [seat], draw: false, reason: "timeout", summary: "время на ход вышло" }, at);
      return;
    }
    const startKey = this.currentTurnKey();
    if (policy === "skip" && this.game.passTurn) {
      this.state = this.game.passTurn(this.state, seat, this.ctx(at));
    } else {
      // random (also the fallback for games without passTurn): finish the turn with random moves
      for (let i = 0; i < 16 && this.phase === "playing"; i++) {
        const legal = this.game.legalActions(this.state, seat, this.ctx(at));
        if (legal.length === 0) {
          if (this.game.passTurn) this.state = this.game.passTurn(this.state, seat, this.ctx(at));
          break;
        }
        const next = this.game.applyAction(this.state, seat, this.rng.pick(legal), this.ctx(at));
        if (isActionError(next)) break;
        this.state = next;
        if (this.game.roundResult(this.state) || this.currentTurnKey() !== startKey) break;
      }
    }
    this.afterChange(at, true);
  }

  private afterChange(at: number, forceTimerReset = false) {
    const rr = this.outcome(at);
    if (rr) {
      this.endRound(rr, at);
      return;
    }
    this.resetTurnTimer(at, forceTimerReset);
  }

  private currentTurnKey(): string {
    if (this.game.turnId) return String(this.game.turnId(this.state));
    return this.game.currentSeats(this.state).join(",");
  }

  private budgetSeconds(): number {
    const custom = this.game.turnBudgetSeconds?.(this.state);
    if (typeof custom === "number" && Number.isFinite(custom)) return Math.max(0, custom);
    return this.config.timer.turnSeconds;
  }

  private resetTurnTimer(at: number, force: boolean) {
    const seconds = this.budgetSeconds();
    if (this.game.kind !== "turn" || seconds <= 0 || this.phase !== "playing") {
      this.turnDeadline = null;
      return;
    }
    const key = this.currentTurnKey();
    if (force || key !== this.turnKey || this.turnDeadline === null) {
      this.turnKey = key;
      this.turnDeadline = at + seconds * 1000;
    }
  }

  private endRound(rr: RoundResult, at: number) {
    this.roundResults.push(rr);
    if (!rr.draw) for (const w of rr.winners) this.scores[w] = (this.scores[w] ?? 0) + 1;
    this.turnDeadline = null;
    const { rounds, stopWhenDecided } = this.config.series;
    if (this.round >= rounds || (stopWhenDecided && this.isDecided())) {
      this.finish();
      return;
    }
    this.phase = "intermission";
    this.intermissionUntil = at + INTERMISSION_MS;
  }

  private isDecided(): boolean {
    const remaining = this.config.series.rounds - this.round;
    const sorted = [...this.scores].sort((a, b) => b - a);
    const [leader = 0, second = 0] = sorted;
    return leader > second + remaining;
  }

  private finish() {
    this.phase = "finished";
    this.intermissionUntil = null;
    const best = Math.max(...this.scores);
    const winners = best > 0 ? this.scores.flatMap((s, i) => (s === best ? [i] : [])) : [];
    this.result = { winners, draw: winners.length !== 1, scores: [...this.scores] };
  }

  private nextRound(at: number) {
    const last = this.roundResults.at(-1);
    const policy = this.config.series.firstPlayer;
    let first = (this.firstSeat + 1) % this.seats;
    if (policy === "same") first = this.firstSeat;
    else if (policy === "loser" && last && !last.draw && last.losers.length > 0) first = last.losers[0] as Seat;
    else if (policy === "loser" && last && !last.draw && last.winners.length > 0) {
      first = (Math.max(...last.winners) + 1) % this.seats;
    } else if (policy === "winner" && last && !last.draw && last.winners.length > 0) first = last.winners[0] as Seat;
    this.firstSeat = first;
    this.round += 1;
    this.phase = "playing";
    this.intermissionUntil = null;
    this.roundStartedAt = at;
    this.ticks = 0;
    this.state = this.game.setup({ ...this.ctx(at), round: this.round, firstSeat: first });
    this.turnKey = "";
    this.resetTurnTimer(at, true);
    this.settle(at);
  }

  /** A round may be over right at setup (degenerate rules); handle it the same way every round. */
  private settle(at: number) {
    const rr = this.outcome(at);
    if (rr) this.endRound(rr, at);
  }

  /**
   * The game's round result. A turn-based round where nobody to move has a legal
   * action ends as a draw instead of hanging: passing, if a game allows it, must be an action.
   */
  private outcome(at: number): RoundResult | null {
    const rr = this.game.roundResult(this.state);
    if (rr || this.game.kind !== "turn") return rr;
    const seats = this.game.currentSeats(this.state);
    const ctx = this.ctx(at);
    if (seats.some((s) => this.game.legalActions(this.state, s, ctx).length > 0)) return null;
    return { winners: [], losers: [], draw: true, reason: "no-moves", summary: "ходов нет" };
  }
}

function fail(code: string, message: string): DispatchResult {
  return { ok: false, error: { code, message } };
}
