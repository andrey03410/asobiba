import type { BotDifficulty, BotOptions } from "@asobiba/api";
import type { Match, PlayerActionForm } from "@asobiba/sdk";
import { createHmac, randomInt } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { badRequest, conflict } from "../http-errors";
import { newId, sha256 } from "../ids";
import type { Prisma } from "../generated/prisma/client";

export const BOT_LEASE_MS = 45_000;
export const BOT_INSTRUCTIONS: Record<BotDifficulty, string> = {
  low: "Играй как новичок. Выбирай понятный ход по текущей ситуации и ближайшей цели.",
  medium: "Проверь очевидную угрозу и возможность выиграть. Учитывай ближайший ответ соперника.",
  high: "Сравни несколько планов, оцени риск и вероятные ответы соперников.",
  maximum: "Ищи лучший доступный ход по цели игры, используя видимую историю и время до конца хода.",
};

export function botOptions(input: BotOptions): Required<BotOptions> {
  const name = input.name.trim();
  if (Array.from(name).length < 1 || Array.from(name).length > 24 || !/^[\p{L}\p{M}\p{N} ._-]+$/u.test(name))
    throw badRequest("bad_bot_name", "Имя ИИ должно содержать от 1 до 24 букв, цифр, пробелов, точек, дефисов или подчёркиваний");
  const difficulty = input.difficulty ?? "medium";
  if (!Object.hasOwn(BOT_INSTRUCTIONS, difficulty)) throw badRequest("bad_difficulty", "Неизвестная сложность");
  return { name, difficulty };
}

export function parseBotLink(link: string, publicUrl: string) {
  let url: URL;
  try { url = new URL(link); } catch { throw badRequest("bad_bot_link", "Нужна ссылка-приглашение в лобби"); }
  const match = url.pathname.match(/^\/lobby\/(lob_[a-zA-Z0-9]+)\/?$/);
  const invite = url.hash.match(/^#bot=([A-Za-z0-9]{36})$/);
  if (url.origin !== new URL(publicUrl).origin || url.username || url.password || !match || (url.hash && !invite))
    throw badRequest("bad_bot_link", "Нужна ссылка на лобби этого сайта");
  return { lobbyId: match[1]!, invite: invite?.[1] };
}

/** The private retry nonce also recovers a lost join response, including after restart. */
export function botKey(lobbyId: string, invite: string | undefined, attempt: string) {
  if (!/^[a-zA-Z0-9_-]{32,80}$/.test(attempt)) throw badRequest("bad_attempt", "Нужен секретный идентификатор попытки входа");
  return "asp_" + sha256(JSON.stringify(["asobiba-player", lobbyId, invite ?? null, attempt]));
}

export async function insertBot(tx: Prisma.TransactionClient, lobbyId: string, options: Required<BotOptions>,
  credentials: { botInviteHash?: string; botKeyHash?: string; botControllerId?: string }) {
  const previous = await tx.lobbyMember.aggregate({ where: { lobbyId }, _max: { botNumber: true } });
  const id = newId("usr");
  await tx.user.create({ data: { id, login: `@bot:${id}`, displayName: options.name, role: "guest" } });
  return tx.lobbyMember.create({ data: { userId: id, lobbyId, role: "player",
    botNumber: (previous._max.botNumber ?? 0) + 1, botDifficulty: options.difficulty, ...credentials } });
}

interface Snapshot {
  kind: "waiting" | "turn" | "observation" | "paused" | "finished";
  matchId: string | null;
  seat: number | null;
  state: unknown;
  actions: PlayerActionForm[];
}

/** Only the derived handle goes to the player. The match secret lives outside the public log and replay seed. */
export function makePlayerHandles(secret: string | null) {
  if (!secret) return undefined;
  return (seat: number, scope: string, value: string) =>
    createHmac("sha256", secret).update(JSON.stringify([seat, scope, value])).digest("base64url").slice(0, 24);
}

export function seatProjection(match: Match, seat: number) {
  const matchView = match.view(seat);
  const now = (matchView.pause?.since ?? match.checkpointAt) - (matchView.clockShiftMs ?? 0);
  const game = match.projectPlayerView(seat, matchView, now);
  return { matchView, game, now };
}

export function playerSnapshot(match: Match | null, matchId: string | null, seat: number | null, names: string[], lobbyState: unknown): Snapshot {
  if (!match || seat === null) return { kind: "waiting", matchId, seat: null, state: lobbyState, actions: [] };
  if (match.pause) return { kind: "paused", matchId, seat, actions: [], state: {
    phase: "paused", pause: match.pause, gameId: match.game.id, seatNames: names, lobby: lobbyState,
  } };
  const { matchView: view, game } = seatProjection(match, seat);
  const playing = !view.pause && view.phase === "playing" && (match.game.kind === "realtime" || view.currentSeats.includes(seat));
  const actions = playing ? match.game.playerActions(game, seat) : [];
  const state = { ...view, game: match.game.compactPlayerView?.(game) ?? game, gameId: match.game.id, seatNames: names, lobby: lobbyState };
  const kind = view.phase === "finished" ? "finished" : view.pause ? "paused" : actions.length ? "turn" : "observation";
  return { kind, matchId, seat, state, actions };
}

export class BotConnection {
  expiresAt = 0;
  private previous: Snapshot | null = null;
  // Unique per attachment after process restart, even when the visible board is identical.
  private cursor = randomInt(2 ** 46);
  private revision = -1;
  private wake?: () => void;

  current(snapshot: Snapshot, revision: number, reading: boolean) {
    // Progressive text and media can become visible between a wait and its action.
    // Only a gameplay change can invalidate that decision during submission.
    if ((this.previous === null || reading || revision !== this.revision) && !isDeepStrictEqual(this.previous, snapshot)) {
      this.previous = snapshot;
      this.cursor++;
      this.notify();
    }
    this.revision = revision;
    return { ...snapshot, cursor: this.cursor };
  }

  invalidate() {
    this.previous = null;
    this.notify();
  }

  notify() { this.wake?.(); }

  wait(timeoutMs: number, signal?: AbortSignal) {
    if (this.wake) throw conflict("already_waiting", "Это место уже ждёт событие");
    if (!timeoutMs || signal?.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        this.wake = undefined;
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.wake = done;
      signal?.addEventListener("abort", done, { once: true });
    });
  }
}
