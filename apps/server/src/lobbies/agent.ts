import type { LobbyAgentComment } from "@asobiba/api";
import type { AgentRole, Match } from "@asobiba/sdk";
import { isDeepStrictEqual } from "node:util";
import { randomString, sha256 } from "../ids";

/** Long enough for a bounded wait plus a decision. Disconnect is detected on the server. */
const LEASE_MS = 45_000;
const EVENT_LIMIT = 24;

export interface PresenterTask {
  key: string;
  kind: "grade" | "control";
  actions: unknown[];
  context: unknown;
}

interface EventData {
  kind: "waiting" | "observation" | "presenter" | "paused" | "finished";
  matchId: string | null;
  state?: unknown;
  task?: PresenterTask;
  comment?: { key: string; text: string };
}

export interface AgentEvent extends EventData {
  cursor: number;
}

export class LobbyAgent {
  status: "waiting" | "connected" | "disconnected" = "waiting";
  notice: string | undefined;
  expiresAt: number | undefined;
  comments: LobbyAgentComment[] = [];
  private secretHash: string | undefined;
  private cursor = 0;
  private previous: EventData | undefined;
  private events: AgentEvent[] = [];
  private publishedComment: string | undefined;
  private readonly listeners = new Set<() => void>();

  attach(now: number): string {
    this.status = "connected";
    this.notice = undefined;
    const key = randomString(36);
    this.secretHash = sha256(key);
    this.events = [];
    this.previous = undefined;
    this.publishedComment = undefined;
    this.renew(now);
    this.notify();
    return key;
  }

  hasKey(key: string): boolean {
    return this.secretHash !== undefined && this.secretHash === sha256(key);
  }

  renew(now: number): void {
    this.expiresAt = now + LEASE_MS;
  }

  drop(status: "waiting" | "disconnected", notice?: string): void {
    this.status = status;
    this.notice = notice;
    this.secretHash = undefined;
    this.expiresAt = undefined;
    this.events = [];
    this.previous = undefined;
    this.notify();
  }

  publish(role: AgentRole | undefined, matchId: string | null, match: Match | null): void {
    if (!role || this.status !== "connected") return;
    const data = agentEvent(role, matchId, match);
    if (isDeepStrictEqual(data, this.previous)) return;
    this.previous = data;
    const { comment, ...state } = data;
    const commentId = comment && `${matchId}/${comment.key}`;
    const eligibleComment = comment && commentId !== this.publishedComment && !this.comments.some((entry) => entry.id === commentId);
    this.events.push({ ...state, ...(eligibleComment ? { comment } : {}), cursor: ++this.cursor });
    if (commentId) this.publishedComment = commentId;
    if (this.events.length > EVENT_LIMIT) this.events.shift();
    this.notify();
  }

  eventAfter(cursor: number): AgentEvent | undefined {
    return this.events.find((event) => event.cursor > cursor);
  }

  get latest(): AgentEvent | undefined { return this.events.at(-1); }

  resetComments(): void {
    this.comments = [];
    this.publishedComment = undefined;
  }

  comment(cursor: number, matchId: string | null): boolean {
    const event = this.events.find((entry) => entry.cursor === cursor && entry.matchId === matchId);
    if (!event?.comment) return false;
    const id = `${event.matchId}/${event.comment.key}`;
    if (this.comments.some((comment) => comment.id === id)) return false;
    this.comments = [...this.comments.slice(1 - EVENT_LIMIT), { id, text: event.comment.text }];
    return true;
  }

  wait(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (this.listeners.size) {
        reject(new Error("Текущий чат уже ждёт событие"));
        return;
      }
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        this.listeners.delete(done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.listeners.add(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  private notify(): void {
    for (const done of this.listeners) done();
  }
}

function agentEvent(role: AgentRole, matchId: string | null, match: Match | null): EventData {
  if (!match) return { kind: "waiting", matchId };
  const view = match.view(null);
  const { phase, round, rounds, scores, result, lastRound } = view;
  const state = { phase, round, rounds, scores, result, lastRound };
  if (role === "presenter") {
    if (phase === "finished") return { kind: "finished", matchId, state };
    const task = (match.view(null, "presenter").game as { agentTask?: PresenterTask }).agentTask;
    if (view.pause) return { kind: "paused", matchId, state: { ...state, reason: view.pause.reason }, ...(task ? { task } : {}) };
    return { kind: "presenter", matchId, state, ...(task ? { task } : {}) };
  }
  const observed = match.game.observeForAgent?.(view.game);
  const comment = observed?.comment
    ? { ...observed.comment, key: `${round}/${observed.comment.key}` }
    : lastRound ? { key: `${view.roundResults.length}/result`, text: `Итог раунда ${view.roundResults.length}: ${lastRound.summary ?? "раунд завершён"}` } : undefined;
  return {
    kind: phase === "finished" ? "finished" : "observation",
    matchId,
    state: { ...state, game: observed?.state },
    ...(role === "commentator" && comment ? { comment } : {}),
  };
}
