import type { CreateLobbyRequest, LobbyDto, LobbyStatus, LobbySummaryDto, ServerMessage, UserDto } from "@asobiba/api";
import { type ConfigDocument, type DispatchResult, type GameCatalog, Match, type MatchLogEntry, type MatchRecord } from "@asobiba/sdk";
import type { Prisma } from "../generated/prisma/client";
import type { ConfigService } from "../configs/service";
import type { Db } from "../db";
import type { Env } from "../env";
import { badRequest, conflict, forbidden, notFound } from "../http-errors";
import { newId, randomSeed } from "../ids";

export interface Subscriber {
  userId: string;
  send(message: ServerMessage): void;
  /** True once the connection is gone; a pending subscribe is then dropped. */
  closed?(): boolean;
}

interface Room {
  lobbyId: string;
  match: Match | null;
  matchId: string | null;
  /** userId by seat in the current or last match. */
  seatUsers: string[];
  finishedSaved: boolean;
  subscribers: Set<Subscriber>;
  timer: NodeJS.Timeout | null;
}

type LobbyRow = Prisma.LobbyGetPayload<{ include: { host: true; members: { include: { user: true } } } }>;

const MAX_TIMER_MS = 2 ** 31 - 1;

export interface LobbyServiceDeps {
  db: Db;
  catalog: GameCatalog;
  configs: ConfigService;
  env: Env;
  now: () => number;
  log: { warn(obj: unknown, msg?: string): void; error(obj: unknown, msg?: string): void };
}

/**
 * Lobbies and their live rooms. A room holds the running match in memory,
 * the WebSocket subscribers and the wake-up timer. Every operation on one
 * lobby runs under that lobby's lock, so async DB writes never interleave.
 */
export class LobbyService {
  private readonly rooms = new Map<string, Room>();
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: LobbyServiceDeps) {}

  private lock<T>(lobbyId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(lobbyId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(lobbyId, tail);
    void tail.then(() => {
      if (this.locks.get(lobbyId) === tail) this.locks.delete(lobbyId);
    });
    return next;
  }

  private async loadRow(lobbyId: string): Promise<LobbyRow> {
    const row = await this.deps.db.lobby.findUnique({
      where: { id: lobbyId },
      include: { host: true, members: { include: { user: true }, orderBy: { joinedAt: "asc" } } },
    });
    if (!row) throw notFound("Лобби не найдено");
    return row;
  }

  /**
   * The in-memory room of a lobby, created on first use. Callers outside the lobby
   * lock may race here, so the map is checked again after the awaits: the room that
   * holds a live match must never be replaced by a fresh one.
   */
  private async room(lobbyId: string): Promise<Room> {
    const existing = this.rooms.get(lobbyId);
    if (existing) return existing;
    const lobby = await this.deps.db.lobby.findUnique({ where: { id: lobbyId }, select: { id: true } });
    if (!lobby) throw notFound("Лобби не найдено");
    const last = await this.deps.db.match.findFirst({ where: { lobbyId }, orderBy: { startedAt: "desc" } });
    const raced = this.rooms.get(lobbyId);
    if (raced) return raced;
    const room: Room = {
      lobbyId,
      match: null,
      matchId: last?.id ?? null,
      seatUsers: (last?.seatUsers as string[] | undefined) ?? [],
      finishedSaved: true,
      subscribers: new Set(),
      timer: null,
    };
    this.rooms.set(lobbyId, room);
    return room;
  }

  private seatsOf(config: ConfigDocument) {
    const game = this.deps.catalog.get(config.game);
    if (!game) throw badRequest("unknown_game", `Игра ${config.game} больше не доступна`);
    return { game, ...game.seats(config.rules) };
  }

  /** Lobby pages and sockets show this copy. The match keeps the stored document. */
  private shownConfig(config: ConfigDocument): ConfigDocument {
    const game = this.deps.catalog.get(config.game);
    if (!game?.presentRules) return config;
    return { ...config, rules: game.presentRules(config.rules) };
  }

  private dto(row: LobbyRow, room: Room | undefined): LobbyDto {
    const config = row.config as unknown as ConfigDocument;
    const { game, min, max } = this.seatsOf(config);
    const seatUsers = room?.seatUsers ?? [];
    return {
      id: row.id,
      name: row.name,
      gameId: row.gameId,
      gameTitle: game.title,
      status: row.status as LobbyStatus,
      host: { id: row.host.id, login: row.host.login },
      seats: max,
      minPlayers: min,
      members: row.members.map((m) => {
        const seat = seatUsers.indexOf(m.userId);
        return {
          userId: m.userId,
          login: m.user.login,
          role: m.role === "player" ? "player" : "spectator",
          seat: m.role === "player" && seat >= 0 ? seat : null,
          joinedAt: m.joinedAt.toISOString(),
        };
      }),
      config: this.shownConfig(config),
      url: `${this.deps.env.publicUrl}/lobby/${row.id}`,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---------- queries ----------

  async get(lobbyId: string): Promise<LobbyDto> {
    const row = await this.loadRow(lobbyId);
    return this.dto(row, await this.room(lobbyId));
  }

  async list(): Promise<LobbySummaryDto[]> {
    const rows = await this.deps.db.lobby.findMany({
      where: { status: { not: "closed" } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { host: true, members: { where: { role: "player" }, select: { userId: true } } },
    });
    return rows.map((row) => {
      const config = row.config as unknown as ConfigDocument;
      const game = this.deps.catalog.get(row.gameId);
      return {
        id: row.id,
        name: row.name,
        gameId: row.gameId,
        gameTitle: game?.title ?? row.gameId,
        configTitle: config.title,
        status: row.status as LobbyStatus,
        host: row.host.login,
        players: row.members.length,
        seats: row.seats,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  /** Short match state for agents: no moves, no board. */
  async matchSummary(lobbyId: string) {
    const room = await this.room(lobbyId);
    if (!room.match) return null;
    const view = room.match.view(null);
    return { phase: view.phase, round: view.round, rounds: view.rounds, scores: view.scores, result: view.result, lastRound: view.lastRound };
  }

  // ---------- commands ----------

  async create(user: UserDto, req: CreateLobbyRequest): Promise<LobbyDto> {
    let input: unknown = req.config;
    if (req.configId) input = (await this.deps.configs.get(user.id, req.configId)).document;
    if (input === undefined) throw badRequest("no_config", "Нужен configId или config");
    const config = await this.deps.configs.requireValid(user.id, input);
    const { max } = this.seatsOf(config);
    const name = (req.name ?? "").trim().slice(0, 60) || config.title;
    const id = newId("lob", 10);
    await this.deps.db.lobby.create({
      data: {
        id,
        name,
        gameId: config.game,
        config: config as unknown as Prisma.InputJsonValue,
        seats: max,
        hostId: user.id,
        members: { create: { userId: user.id, role: "player" } },
      },
    });
    return this.get(id);
  }

  join(user: UserDto, lobbyId: string, role: "player" | "spectator"): Promise<LobbyDto> {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      if (row.status === "closed") throw conflict("closed", "Лобби закрыто");
      const room = await this.room(lobbyId);
      const me = row.members.find((m) => m.userId === user.id);
      const players = row.members.filter((m) => m.role === "player").length;
      const seated = room.match?.currentPhase !== "finished" && row.status === "playing" && room.seatUsers.includes(user.id);
      if (me?.role === role) return this.dto(row, room);
      if (role === "player") {
        if (row.status === "playing") throw conflict("match_in_progress", "Идёт партия: можно смотреть, а сесть — после неё");
        if (players >= row.seats) throw conflict("lobby_full", "Все места заняты");
      } else if (seated) {
        throw conflict("match_in_progress", "Нельзя встать из-за стола посреди партии");
      }
      if (me) await this.deps.db.lobbyMember.update({ where: { lobbyId_userId: { lobbyId, userId: user.id } }, data: { role } });
      else await this.deps.db.lobbyMember.create({ data: { lobbyId, userId: user.id, role } });
      return this.publishLobby(room);
    });
  }

  leave(user: UserDto, lobbyId: string): Promise<LobbyDto> {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      const room = await this.room(lobbyId);
      if (row.hostId === user.id) throw conflict("host_cannot_leave", "Хозяин не уходит, а закрывает лобби");
      if (row.status === "playing" && room.seatUsers.includes(user.id)) throw conflict("match_in_progress", "Нельзя уйти посреди партии");
      await this.deps.db.lobbyMember.deleteMany({ where: { lobbyId, userId: user.id } });
      return this.publishLobby(room);
    });
  }

  start(user: UserDto, lobbyId: string): Promise<LobbyDto> {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      if (row.hostId !== user.id) throw forbidden("Начать партию может только хозяин лобби");
      if (row.status === "playing") throw conflict("already_playing", "Партия уже идёт");
      if (row.status === "closed") throw conflict("closed", "Лобби закрыто");
      const config = row.config as unknown as ConfigDocument;
      const { game, min, max } = this.seatsOf(config);
      const players = row.members.filter((m) => m.role === "player").map((m) => m.userId);
      if (players.length < min || players.length > max) {
        throw conflict("not_enough_players", min === max ? `Нужно ровно ${min} игрока` : `Нужно от ${min} до ${max} игроков`);
      }
      const room = await this.room(lobbyId);
      let seatUsers = players;
      const prev = room.seatUsers;
      if (prev.length === players.length && prev.every((u) => players.includes(u))) seatUsers = [...prev.slice(1), ...prev.slice(0, 1)];
      const now = this.deps.now();
      const seed = randomSeed();
      const match = Match.start({ game, config, seats: seatUsers.length, seed, startedAt: now });
      const matchId = newId("mat");
      await this.deps.db.$transaction([
        this.deps.db.match.updateMany({ where: { lobbyId, status: "playing" }, data: { status: "aborted", finishedAt: new Date(now) } }),
        this.deps.db.match.create({
          data: { id: matchId, lobbyId, seed, startedAt: new Date(now), seatUsers, log: [], status: "playing" },
        }),
        this.deps.db.lobby.update({ where: { id: lobbyId }, data: { status: "playing" } }),
      ]);
      Object.assign(room, { match, matchId, seatUsers, finishedSaved: false });
      await this.afterMatchChange(room);
      const dto = await this.publishLobby(room);
      this.publishMatch(room);
      return dto;
    });
  }

  close(user: UserDto, lobbyId: string): Promise<LobbyDto> {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      if (row.hostId !== user.id) throw forbidden("Закрыть лобби может только хозяин");
      const room = await this.room(lobbyId);
      const now = new Date(this.deps.now());
      await this.deps.db.$transaction([
        this.deps.db.match.updateMany({ where: { lobbyId, status: "playing" }, data: { status: "aborted", finishedAt: now } }),
        this.deps.db.lobby.update({ where: { id: lobbyId }, data: { status: "closed" } }),
      ]);
      if (room.timer) clearTimeout(room.timer);
      room.timer = null;
      room.match = null;
      const dto = await this.publishLobby(room);
      this.publishMatch(room);
      return dto;
    });
  }

  action(user: UserDto, lobbyId: string, action: unknown): Promise<DispatchResult> {
    return this.lock(lobbyId, async () => {
      const room = await this.room(lobbyId);
      if (!room.match) return { ok: false, error: { code: "no_match", message: "Партия не идёт" } };
      const seat = room.seatUsers.indexOf(user.id);
      if (seat < 0) return { ok: false, error: { code: "not_a_player", message: "Вы не играете в этой партии" } };
      const now = this.deps.now();
      // run due timers first: a late action may be rejected after a timeout or the
      // final round already happened, and clients must still see that change
      const advanced = room.match.advance(now);
      const res = room.match.dispatch(seat, action, now);
      if (!res.ok) {
        if (advanced) {
          await this.afterMatchChange(room);
          this.publishMatch(room);
        }
        return res;
      }
      await this.deps.db.match.update({
        where: { id: room.matchId as string },
        data: { log: room.match.record().log as unknown as Prisma.InputJsonValue },
      });
      await this.afterMatchChange(room);
      this.publishMatch(room);
      return res;
    });
  }

  // ---------- live updates ----------

  async subscribe(sub: Subscriber, lobbyId: string): Promise<void> {
    await this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      const room = await this.room(lobbyId);
      if (sub.closed?.()) return; // the socket went away while we waited for the lock
      room.subscribers.add(sub);
      sub.send({ type: "lobby", lobby: this.dto(row, room) });
      this.sendMatch(room, sub);
    });
  }

  unsubscribe(sub: Subscriber, lobbyId?: string): void {
    for (const room of lobbyId ? [this.rooms.get(lobbyId)] : this.rooms.values()) room?.subscribers.delete(sub);
    // a subscribe for this lobby may still be waiting for the lock: remove again after it
    if (lobbyId) void this.lock(lobbyId, async () => void this.rooms.get(lobbyId)?.subscribers.delete(sub)).catch(() => {});
  }

  private async publishLobby(room: Room): Promise<LobbyDto> {
    const dto = this.dto(await this.loadRow(room.lobbyId), room);
    for (const sub of room.subscribers) sub.send({ type: "lobby", lobby: dto });
    return dto;
  }

  private sendMatch(room: Room, sub: Subscriber) {
    const seatIndex = room.seatUsers.indexOf(sub.userId);
    const seat = room.match && seatIndex >= 0 ? seatIndex : null;
    sub.send({ type: "match", lobbyId: room.lobbyId, match: room.match ? room.match.view(seat) : null, seat, serverTime: this.deps.now() });
  }

  private publishMatch(room: Room) {
    for (const sub of room.subscribers) this.sendMatch(room, sub);
  }

  private async afterMatchChange(room: Room): Promise<void> {
    const match = room.match;
    if (!match) return;
    if (match.currentPhase === "finished" && !room.finishedSaved) {
      room.finishedSaved = true;
      const now = new Date(this.deps.now());
      await this.deps.db.$transaction([
        this.deps.db.match.update({
          where: { id: room.matchId as string },
          data: { status: "finished", finishedAt: now, result: match.finalResult as unknown as Prisma.InputJsonValue },
        }),
        this.deps.db.lobby.update({ where: { id: room.lobbyId }, data: { status: "finished" } }),
      ]);
      await this.publishLobby(room);
    }
    this.schedule(room);
  }

  private schedule(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    const at = room.match?.nextWakeAt();
    if (at === null || at === undefined) return;
    const delay = Math.min(Math.max(0, at - this.deps.now()), MAX_TIMER_MS);
    room.timer = setTimeout(() => void this.wake(room.lobbyId), delay);
    room.timer.unref?.();
  }

  private wake(lobbyId: string): Promise<void> {
    return this.lock(lobbyId, async () => {
      const room = this.rooms.get(lobbyId);
      if (!room?.match) return;
      const changed = room.match.advance(this.deps.now());
      await this.afterMatchChange(room);
      if (changed) this.publishMatch(room);
    }).catch((e) => this.deps.log.error({ err: e, lobbyId }, "lobby wake failed"));
  }

  /** After a restart: replays turn-based matches from their logs, aborts realtime ones. */
  async restoreAll(): Promise<{ restored: number; aborted: number }> {
    const playing = await this.deps.db.lobby.findMany({ where: { status: "playing" } });
    let restored = 0;
    let aborted = 0;
    for (const lobby of playing) {
      await this.lock(lobby.id, async () => {
        const config = lobby.config as unknown as ConfigDocument;
        const game = this.deps.catalog.get(config.game);
        const row = await this.deps.db.match.findFirst({ where: { lobbyId: lobby.id, status: "playing" }, orderBy: { startedAt: "desc" } });
        const room = await this.room(lobby.id);
        if (!game || !row || game.kind === "realtime") {
          await this.deps.db.$transaction([
            this.deps.db.match.updateMany({ where: { lobbyId: lobby.id, status: "playing" }, data: { status: "aborted", finishedAt: new Date() } }),
            this.deps.db.lobby.update({ where: { id: lobby.id }, data: { status: "waiting" } }),
          ]);
          aborted++;
          return;
        }
        const seatUsers = row.seatUsers as string[];
        const record: MatchRecord = { seed: row.seed, startedAt: row.startedAt.getTime(), seats: seatUsers.length, log: row.log as unknown as MatchLogEntry[] };
        try {
          const match = Match.restore({ game, config, record, now: this.deps.now() });
          Object.assign(room, { match, matchId: row.id, seatUsers, finishedSaved: false });
          await this.afterMatchChange(room);
          restored++;
        } catch (e) {
          this.deps.log.warn({ err: e, lobbyId: lobby.id }, "match restore failed, aborting");
          await this.deps.db.$transaction([
            this.deps.db.match.update({ where: { id: row.id }, data: { status: "aborted", finishedAt: new Date() } }),
            this.deps.db.lobby.update({ where: { id: lobby.id }, data: { status: "waiting" } }),
          ]);
          aborted++;
        }
      });
    }
    return { restored, aborted };
  }

  shutdown(): void {
    for (const room of this.rooms.values()) if (room.timer) clearTimeout(room.timer);
    this.rooms.clear();
  }
}
