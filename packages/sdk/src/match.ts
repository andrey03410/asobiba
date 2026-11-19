import type { ConfigDocument } from "./config";
import { type AnyGame, type ControlRole, type GameContext, isActionError, type RoundResult, type Seat } from "./game";
import { createRng, type Rng } from "./rng";

/** Pause between rounds so players can see how the round ended. */
export const INTERMISSION_MS = 3000;
const MAX_EVENTS_PER_ADVANCE = 100_000;

export type MatchPauseReason = "manual" | "presenter-disconnected";

export interface MatchPause {
  readonly reason: MatchPauseReason;
  /** Wall time at which the game clock stopped. */
  readonly since: number;
}

export interface MatchLogEntry {
  /** Wall time. */
  at: number;
  seat: Seat;
  action: unknown;
  /** A control uses seat -1 and is replayed through the trusted control channel. */
  controlRole?: ControlRole;
  /** A match-level pause uses seat -1 and a null action. A null reason resumes play. */
  pauseReason?: MatchPauseReason | null;
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
  pause?: MatchPause;
  /** Elapsed wall time spent in completed pauses. Deadlines use the game clock. */
  clockShiftMs?: number;
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
 * turn timer and fixed realtime steps. Actions, controls and match pauses are
 * logged. Timer and tick events are derived from the game clock during replay.
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
  private wallClock: number;
  private pauseState: MatchPause | null = null;
  private clockShiftMs = 0;

  private constructor(options: StartOptions) {
    this.game = options.game;
    this.config = options.config;
    this.seats = options.seats;
    this.seed = options.seed;
    this.startedAt = options.startedAt;
    this.rng = createRng(options.seed);
    this.scores = Array.from({ length: options.seats }, () => 0);
    this.wallClock = options.startedAt;
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
      let res: DispatchResult;
      if (entry.pauseReason !== undefined) res = match.setPaused(entry.pauseReason, entry.at);
      else if (entry.controlRole) res = match.dispatchControl(entry.controlRole, entry.action, entry.at);
      else res = match.dispatch(entry.seat, entry.action, entry.at);
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

  get checkpointAt(): number {
    return this.wallClock;
  }

  get pause(): MatchPause | null {
    return this.pauseState;
  }

  canRecoverAlgorithm(): boolean {
    return this.phase === "playing" && (this.game.canRecoverAlgorithm?.(this.state) ?? false);
  }

  private get gameClock(): number {
    return (this.pauseState?.since ?? this.wallClock) - this.clockShiftMs;
  }

  record(): MatchRecord {
    return { seed: this.seed, startedAt: this.startedAt, seats: this.seats, log: [...this.log] };
  }

  /** Changes the match pause at wall time `at`. A presenter disconnect takes precedence. */
  setPaused(reason: MatchPauseReason | null, at: number): DispatchResult {
    this.advance(Math.max(at, this.wallClock));
    const previous = this.pauseState;
    if (reason === (previous?.reason ?? null)) return { ok: true };
    if (reason === "manual" && previous?.reason === "presenter-disconnected") return { ok: true };
    if (reason === null) {
      if (previous) this.clockShiftMs += this.wallClock - previous.since;
      this.pauseState = null;
    } else {
      if (this.phase === "finished") return fail("finished", "Партия закончена");
      this.pauseState = { reason, since: previous?.since ?? this.wallClock };
    }
    this.log.push({ at: this.wallClock, seat: -1, action: null, pauseReason: reason });
    return { ok: true };
  }

  /** Applies a human action. Pending timer and round events up to `at` are processed first. */
  dispatch(seat: Seat, rawAction: unknown, at: number): DispatchResult {
    this.advance(Math.max(at, this.wallClock));
    if (seat < 0 || seat >= this.seats || !Number.isInteger(seat)) return fail("bad_seat", "Нет такого места");
    if (this.phase === "finished") return fail("finished", "Партия закончена");
    if (this.pauseState) return fail("paused", "Партия на паузе");
    if (this.phase === "intermission") return fail("intermission", "Пауза между раундами");
    const parsed = this.game.actionSchema.safeParse(rawAction);
    if (!parsed.success) return fail("bad_action", parsed.error.issues[0]?.message ?? "Неверное действие");
    if (this.game.kind === "turn" && !this.game.currentSeats(this.state).includes(seat)) {
      return fail("not_your_turn", "Сейчас не ваш ход");
    }
    const rngState = this.rng.state();
    const next = this.game.applyAction(this.state, seat, parsed.data, this.ctx(this.gameClock));
    if (isActionError(next)) {
      // rejected actions are not logged, so they must not move the generator either
      this.rng.restore(rngState);
      return { ok: false, error: next.error };
    }
    this.state = next;
    this.log.push({ at: this.wallClock, seat, action: parsed.data });
    this.afterChange(this.gameClock);
    return { ok: true };
  }

  /** Applies an independently authorized control; payload fields never grant a role. */
  dispatchControl(role: ControlRole, rawAction: unknown, at: number): DispatchResult {
    this.advance(Math.max(at, this.wallClock));
    if (!["host", "presenter", "system"].includes(role)) return fail("bad_control_role", "Неизвестная роль управления");
    if (this.pauseState && role !== "system") return fail("paused", "Партия на паузе");
    if (!this.game.applyControl) return fail("no_controls", "Игра не поддерживает управление");
    if (this.phase === "finished") return fail("finished", "Партия закончена");
    if (this.phase === "intermission") return fail("intermission", "Пауза между раундами");
    const rngState = this.rng.state();
    const next = this.game.applyControl(this.state, rawAction, { ...this.ctx(this.gameClock), role });
    if (isActionError(next)) {
      this.rng.restore(rngState);
      return { ok: false, error: next.error };
    }
    this.state = next;
    this.log.push({ at: this.wallClock, seat: -1, action: structuredClone(rawAction), controlRole: role });
    this.afterChange(this.gameClock);
    return { ok: true };
  }

  /** Processes timers, intermissions and realtime steps up to wall time `now`. */
  advance(now: number): boolean {
    if (this.pauseState) {
      this.wallClock = Math.max(this.wallClock, now);
      return false;
    }
    const until = now - this.clockShiftMs;
    let changed = false;
    for (let i = 0; i < MAX_EVENTS_PER_ADVANCE; i++) {
      const next = this.nextEvent();
      if (!next || next.at > until) break;
      next.run();
      changed = true;
    }
    this.wallClock = Math.max(this.wallClock, now);
    return changed;
  }

  /** When the server should call `advance` next, or null if nothing is scheduled. */
  nextWakeAt(): number | null {
    if (this.pauseState) return null;
    const next = this.nextEvent();
    return next ? next.at + this.clockShiftMs : null;
  }

  view(seat: Seat | null, role?: ControlRole): MatchView {
    return {
      phase: this.phase,
      round: this.round,
      rounds: this.config.series.rounds,
      scores: [...this.scores],
      seats: this.seats,
      currentSeats: this.phase === "playing" && !this.pauseState ? this.game.currentSeats(this.state) : [],
      turnDeadline: this.turnDeadline,
      intermissionUntil: this.intermissionUntil,
      ...(this.pauseState && { pause: this.pauseState }),
      ...(this.clockShiftMs && { clockShiftMs: this.clockShiftMs }),
      lastRound: this.roundResults.at(-1) ?? null,
      roundResults: [...this.roundResults],
      result: this.result,
      game: role === "presenter" && this.game.presenterView ? this.game.presenterView(this.state) : this.game.view(this.state, seat),
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
    const gameWake = this.game.nextWakeAt?.(this.state);
    if (this.game.wake && typeof gameWake === "number" && Number.isFinite(gameWake)) {
      const at = Math.max(this.gameClock, gameWake);
      candidates.push({ at, run: () => {
        this.state = this.game.wake!(this.state, this.ctx(at));
        this.afterChange(at);
      } });
    }
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
        let action: unknown;
        let available: boolean;
        if (this.game.sampleAction) {
          action = this.game.sampleAction(this.state, seat, this.ctx(at));
          available = action !== null;
        } else {
          const legal = this.game.legalActions(this.state, seat, this.ctx(at));
          available = legal.length > 0;
          if (available) action = this.rng.pick(legal);
        }
        if (!available) {
          if (this.game.passTurn) this.state = this.game.passTurn(this.state, seat, this.ctx(at));
          break;
        }
        const next = this.game.applyAction(this.state, seat, action, this.ctx(at));
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
    if (rr || this.game.kind !== "turn" || this.game.applyControl || this.game.nextWakeAt) return rr;
    const seats = this.game.currentSeats(this.state);
    const ctx = this.ctx(at);
    if (seats.some((s) => this.game.hasLegalAction ? this.game.hasLegalAction(this.state, s, ctx) : this.game.legalActions(this.state, s, ctx).length > 0)) return null;
    return { winners: [], losers: [], draw: true, reason: "no-moves", summary: "ходов нет" };
  }
}

function fail(code: string, message: string): DispatchResult {
  return { ok: false, error: { code, message } };
}
