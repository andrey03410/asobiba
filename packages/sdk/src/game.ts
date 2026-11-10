import type { z } from "zod";
import type { ConfigIssue } from "./issues";
import type { Rng } from "./rng";

/** Seat index: 0 … seats-1. Seat order is the order players joined the lobby. */
export type Seat = number;

export interface RoundResult {
  winners: Seat[];
  losers: Seat[];
  draw: boolean;
  /** Machine-readable reason: line, most-lines, board-full, timeout, … */
  reason: string;
  /**
   * Short reason in Russian without seat numbers or names ("собрана линия").
   * Clients prepend the winners' names themselves.
   */
  summary?: string;
}

export interface ActionError {
  error: { code: string; message: string };
}

export function actionError(code: string, message: string): ActionError {
  return { error: { code, message } };
}

export function isActionError(value: unknown): value is ActionError {
  return typeof value === "object" && value !== null && "error" in value && typeof (value as ActionError).error?.code === "string";
}

export interface GameContext<R> {
  rules: R;
  seats: number;
  rng: Rng;
  now: number;
}

export interface SetupContext<R> extends GameContext<R> {
  round: number;
  firstSeat: Seat;
}

export interface TickContext<R> extends GameContext<R> {
  tick: number;
  dtMs: number;
}

/** A visual slot that accepts a developer preset and/or an image from the user's pool. */
export interface SlotDescriptor {
  /** Path inside the config, e.g. `visual.pieces[i]` or `visual.board.background`. */
  path: string;
  title: string;
  accepts: ReadonlyArray<"preset" | "asset">;
  presets?: readonly string[];
  /** Advice on size, proportions, transparency. */
  advice: string;
}

export interface ThemeDescriptor {
  id: string;
  title: string;
  description: string;
}

/** Ready-made partial config. Unset fields take schema defaults. */
export interface ConfigPreset {
  id: string;
  title: string;
  description: string;
  config: {
    title?: string;
    rules?: Record<string, unknown>;
    series?: Record<string, unknown>;
    timer?: Record<string, unknown>;
    visual?: Record<string, unknown>;
  };
}

export interface GameDefinition<R = unknown, V = unknown, S = unknown, A = unknown, PV = unknown> {
  id: string;
  /** Bump when the config schema changes incompatibly. */
  version: number;
  title: string;
  summary: string;
  kind: "turn" | "realtime";
  /** Realtime only: simulation steps per second. */
  tickRate?: number;

  rulesSchema: z.ZodType<R>;
  visualSchema: z.ZodType<V>;
  actionSchema: z.ZodType<A>;

  /** How many players the rules need. A lobby has `max` seats and starts with at least `min`. */
  seats(rules: R): { min: number; max: number };
  /** Cross-field checks the schema cannot express. Paths are relative to `rules`. */
  checkRules?(rules: R): ConfigIssue[];
  /** Paths are relative to `visual`. */
  checkVisual?(visual: V, rules: R): ConfigIssue[];

  /** Optional computation limit across all rounds of one random simulation. */
  simulationBudget?(rules: R): { maxTotalActions: number; maxDurationMs?: number };

  /**
   * Seconds allowed for the current turn. `0` clears the deadline.
   * When omitted, the engine uses `timer.turnSeconds` from the config.
   * The timeout policy is `timeoutPolicy` of the game, else `timer.onTimeout`.
   */
  turnBudgetSeconds?(state: S): number;

  /**
   * The game decides what a timeout does; `timer.onTimeout` of the config is then
   * ignored. Games whose `legalActions` include secret answers (so that random
   * simulations can finish) must not let `random` play them for a silent player.
   */
  timeoutPolicy?: "skip" | "random" | "lose";

  /**
   * Rules safe to show every lobby member. The stored document and the match
   * keep the original. Games use this to hide secret answers.
   */
  presentRules?(rules: R): R;

  setup(ctx: SetupContext<R>): S;
  /** Seats allowed to act now. Empty for realtime games where everybody may act. */
  currentSeats(state: S): Seat[];
  /** Identity of the current turn; a new value restarts the turn timer. */
  turnId?(state: S): string | number;
  legalActions(state: S, seat: Seat, ctx: GameContext<R>): A[];
  applyAction(state: S, seat: Seat, action: A, ctx: GameContext<R>): S | ActionError;
  /** Hands the turn to the next seat (timer policy `skip`). */
  passTurn?(state: S, seat: Seat, ctx: GameContext<R>): S;
  /** Realtime only: one fixed simulation step. */
  tick?(state: S, ctx: TickContext<R>): S;
  roundResult(state: S): RoundResult | null;
  /** What a seat (or a spectator, `null`) may see. */
  view(state: S, seat: Seat | null): PV;

  /** Markdown guide for agents: how details combine, what is fun, limits. */
  guide: string;
  presets: ConfigPreset[];
  slots: SlotDescriptor[];
  themes: ThemeDescriptor[];
  /** Named lists of visual presets with descriptions, e.g. pieces, animations. */
  visualCatalog: Record<string, Record<string, string>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGame = GameDefinition<any, any, any, any, any>;

export function defineGame<R, V, S, A, PV>(game: GameDefinition<R, V, S, A, PV>): GameDefinition<R, V, S, A, PV> {
  return game;
}
