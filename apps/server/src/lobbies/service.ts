import { kanameEnabled } from "@kaname/service-client";
import { grantForUser } from "../kaname";
import { PLAYER_TOKEN_PREFIX } from "../auth/service";
import type { BotOptions, BotDifficulty, ConfigDto, CreateLobbyRequest, LobbyAgentAssignment, LobbyAgentCommand, LobbyDto, LobbyInvitationDto, LobbyStatus, LobbySummaryDto, ServerMessage, UserDto } from "@asobiba/api";
import { collectAssetRefs, describeConfig, type ConfigDocument, type VideoDirective, type DispatchResult, type GameCatalog, Match, type MatchLogEntry, type MatchRecord } from "@asobiba/sdk";
import { quizorCanUseAgentPresenter, quizorCanUseAlgorithm, type QuizorRules } from "@asobiba/game-quizor";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "../generated/prisma/client";
import type { ConfigService } from "../configs/service";
import type { Db } from "../db";
import type { Env } from "../env";
import { quizorMediaRefs, yomifudaMediaRefs } from "../games/media-refs";
import { badRequest, conflict, forbidden, notFound } from "../http-errors";
import { newId, randomSeed, randomString, sha256 } from "../ids";
import { BOT_INSTRUCTIONS, BOT_LEASE_MS, BotConnection, botKey, botOptions, insertBot, parseBotLink, playerSnapshot, seatProjection } from "./bot-seat";
import { LobbyAgent, type AgentEvent } from "./agent";

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
  seatNames: string[];
  finishedSaved: boolean;
  subscribers: Set<Subscriber>;
  timer: NodeJS.Timeout | null;
  hostId: string;
  presenterId: string | null;
  playerIds: Set<string>;
  presence: Set<number> | null;
  presenterOnline: boolean | null;
  agent: LobbyAgent;
  bots: Map<string, BotConnection>;
  botLobbyState: unknown;
  revision: number;
  botMemberIds: Set<string>;
  agentAssignment: LobbyAgentAssignment | null;
  agentCheckpointAt: number | null;
}

type LobbyRow = Prisma.LobbyGetPayload<{ include: { host: true; members: { include: { user: true } } } }>;

const MAX_TIMER_MS = 2 ** 31 - 1;
const AGENT_CHECKPOINT_INTERVAL_MS = 5_000;
/** Directives a viewer keeps access to, and viewers remembered at once. */
const VIDEO_WINDOW = 16;
const VIDEO_VIEWERS = 2000;

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
  private readonly videoSeen = new Map<string, Map<string, VideoDirective>>();
  private readonly videoFiles = new Map<string, Set<string>>();
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
      include: { host: true, members: { where: { role: { not: "removed-bot" } }, include: { user: true }, orderBy: { joinedAt: "asc" } } },
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
    const lobby = await this.deps.db.lobby.findUnique({ where: { id: lobbyId }, select: { id: true, hostId: true, status: true, config: true, agent: true, members: { select: { userId: true, role: true, botNumber: true } } } });
    if (!lobby) throw notFound("Лобби не найдено");
    const last = await this.deps.db.match.findFirst({ where: { lobbyId }, orderBy: { startedAt: "desc" } });
    const raced = this.rooms.get(lobbyId);
    if (raced) return raced;
    let match: Match | null = null;
    if (lobby.status === "finished" && last?.status === "finished") {
      const config = lobby.config as unknown as ConfigDocument;
      const game = this.deps.catalog.get(config.game);
      if (game?.kind === "turn") {
        try {
          const seats = last.seatUsers as string[];
          const record: MatchRecord = { seed: last.seed, startedAt: last.startedAt.getTime(), seats: seats.length, log: last.log as unknown as MatchLogEntry[] };
          const restored = Match.restore({ game, config, record, now: last.finishedAt?.getTime() ?? this.deps.now() });
          if (restored.currentPhase !== "finished") throw new Error("Saved finished match did not finish during replay");
          match = restored;
        } catch (error) {
          this.deps.log.warn({ err: error, lobbyId }, "finished match restore failed");
        }
      }
    }
    const room: Room = {
      lobbyId,
      match,
      matchId: last?.id ?? null,
      seatUsers: (last?.seatUsers as string[] | undefined) ?? [],
      seatNames: (last?.seatNames as string[] | undefined) ?? [],
      finishedSaved: true,
      subscribers: new Set(),
      timer: null,
      hostId: lobby.hostId,
      presenterId: lobby.members.find(member => member.role === "presenter")?.userId ?? null,
      playerIds: new Set(lobby.members.filter(member => member.role === "player").map(member => member.userId)),
      presence: null,
      presenterOnline: null,
      agent: new LobbyAgent(),
      bots: new Map(),
      botLobbyState: null,
      revision: 0,
      botMemberIds: new Set(lobby.members.filter(member => member.botNumber !== null && member.role === "player").map(member => member.userId)),
      agentAssignment: lobby.agent as LobbyAgentAssignment | null,
      agentCheckpointAt: null,
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
    const assignment = row.agent as LobbyAgentAssignment | null;
    return {
      id: row.id,
      name: row.name,
      gameId: row.gameId,
      gameTitle: game.title,
      status: row.status as LobbyStatus,
      host: { id: row.host.id, login: (row.host.displayName ?? row.host.login) },
      seats: max,
      minPlayers: min,
      seatNames: room?.seatNames ?? [],
      members: row.members.map((m) => {
        const seat = seatUsers.indexOf(m.userId);
        return {
          userId: m.userId,
          login: this.memberName(m),
          ...(m.botNumber !== null ? { bot: { number: m.botNumber, difficulty: m.botDifficulty as BotDifficulty,
            status: !m.botKeyHash ? "reserved" : (room?.bots.get(m.userId)?.expiresAt ?? 0) > this.deps.now() ? "connected" : "disconnected" } as const } : {}),
          role: m.role === "player" ? "player" : m.role === "presenter" ? "presenter" : "spectator",
          seat: m.role === "player" && seat >= 0 ? seat : null,
          ...(m.role === "spectator" ? { eligiblePresenter: row.status !== "playing" || seat < 0 } : {}),
          joinedAt: m.joinedAt.toISOString(),
        };
      }),
      config: this.shownConfig(config),
      ...(row.createdByAgent ? { createdByAgent: true } : {}),
      ...(assignment ? { agent: { role: assignment.role, status: room?.agent.status ?? "waiting", canUseAlgorithm: assignment.role === "presenter" && config.game === "quizor" && (row.status === "playing" && room?.match
        ? room.match.canRecoverAlgorithm() : quizorCanUseAlgorithm(config.rules as QuizorRules)) } } : {}),
      ...(room?.agent.notice ? { agentNotice: room.agent.notice } : {}),
      ...(room?.agent.comments.length ? { agentComments: room.agent.comments } : {}),
      information: describeConfig(game, config),
      url: `${this.deps.env.publicUrl}/lobby/${row.id}`,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---------- queries ----------

  private memberName(member: LobbyRow["members"][number]): string {
    if (member.botNumber !== null) return `${member.user.displayName} · ИИ №${member.botNumber}`;
    return member.user.role === "guest" ? `${member.user.displayName} · гость ${member.guestNumber}` : (member.user.displayName ?? member.user.login);
  }

  async invitation(lobbyId: string): Promise<LobbyInvitationDto> {
    const row = await this.loadRow(lobbyId);
    const game = this.deps.catalog.get(row.gameId);
    const summary = game ? describeConfig(game, row.config as unknown as ConfigDocument).summary : null;
    return { id: row.id, name: row.name, gameTitle: game?.title ?? row.gameId,
      description: game?.summary ?? "Игра с друзьями", parameters: summary?.highlights.slice(0, 3) ?? [],
      host: (row.host.displayName ?? row.host.login), status: row.status as LobbyStatus,
      players: row.members.filter((m) => m.role === "player").length, seats: row.seats };
  }

  async visit(user: UserDto, lobbyId: string): Promise<void> {
    await this.loadRow(lobbyId);
    await this.deps.db.lobbyVisit.upsert({ where: { lobbyId_userId: { lobbyId, userId: user.id } },
      create: { lobbyId, userId: user.id }, update: {} });
  }

  /** File authorization uses the actual viewer-safe state, never stored quiz questions. */
  async canReadAsset(userId: string, assetId: string): Promise<boolean> {
    const [asset, user] = await Promise.all([
      this.deps.db.asset.findUnique({ where: { id: assetId }, select: { ownerId: true } }),
      this.deps.db.user.findUnique({ where: { id: userId }, select: { role: true } }),
    ]);
    if (!asset || !user) return false;
    if (asset.ownerId === userId) return true;
    const rows = await this.deps.db.lobby.findMany({
      where: { OR: [{ visits: { some: { userId } } }, { members: { some: { userId } } }] },
      select: { id: true, config: true },
    });
    for (const row of rows) {
      const config = row.config as unknown as ConfigDocument;
      const safeConfig = this.shownConfig(config);
      if (collectAssetRefs(safeConfig).some(ref => ref.assetId === assetId)) return true;
      if (config.game !== "quizor" && config.game !== "yomifuda") continue;
      const room = await this.room(row.id);
      // Presenter secrets are deliberately excluded: a known future file stays closed.
      const view = room.match?.view(this.viewerSeat(room, userId));
      const refs = view ? (config.game === "yomifuda" ? yomifudaMediaRefs(view.game) : quizorMediaRefs(view.game)) : [];
      if (refs.some(ref => ref.assetId === assetId)) return true;
    }
    return false;
  }

  async guestCanReadAsset(userId: string, assetId: string): Promise<boolean> {
    return this.canReadAsset(userId, assetId);
  }

  /** Called under the session lock; each lobby lock also excludes a concurrent start. */
  async endGuest(userId: string, confirmActive: boolean): Promise<void> {
    const memberships = await this.deps.db.lobbyMember.findMany({ where: { userId }, select: { lobbyId: true } });
    const ids = memberships.map((m) => m.lobbyId).sort();
    const locked = async (index: number): Promise<void> => {
      if (index < ids.length) return this.lock(ids[index]!, () => locked(index + 1));
      const rows = await Promise.all(ids.map((id) => this.loadRow(id)));
      const active = (row: LobbyRow) => row.status === "playing" && row.members.some((m) => m.userId === userId && (m.role === "player" || m.role === "presenter"));
      if (!confirmActive && rows.some(active)) throw conflict("active_guest_matches", "Вы участвуете в партии. После выхода вы потеряете доступ к месту, аккаунт не сможет продолжить за гостя. Без таймера партия может ждать вас; хозяин сможет закрыть лобби. Выйти?");
      for (const row of rows) {
        if (active(row)) continue;
        await this.deps.db.lobbyMember.deleteMany({ where: { lobbyId: row.id, userId } });
        await this.publishLobby(await this.room(row.id));
      }
      await this.deps.db.lobbyVisit.deleteMany({ where: { userId } });
    };
    await locked(0);
  }

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
        host: (row.host.displayName ?? row.host.login),
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

  async create(user: UserDto, req: CreateLobbyRequest, createdByAgent = false): Promise<LobbyDto> {
    const { id } = await this.insertLobby(user, req, createdByAgent);
    return this.get(id);
  }

  async createWithBot(user: UserDto, req: CreateLobbyRequest, bot: BotOptions) {
    const invite = randomString(36);
    const { id, botId } = await this.insertLobby(user, req, true, { options: botOptions(bot), invite });
    const lobby = await this.get(id);
    return { lobby, userId: botId!, inviteUrl: `${lobby.url}#bot=${invite}` };
  }

  private async insertLobby(user: UserDto, req: CreateLobbyRequest, createdByAgent: boolean,
    bot?: { options: Required<BotOptions>; invite: string }) {
    if (user.role === "guest") throw forbidden("Создать лобби можно только с аккаунтом");
    if ((req.configId !== undefined) === (req.config !== undefined)) {
      throw badRequest("config_source", "Передайте ровно одно: config или свой configId");
    }
    const source = req.configId === undefined ? { config: req.config } : { configId: req.configId };
    const config = await this.deps.configs.requireValid(user.id, source);
    const { max } = this.seatsOf(config);
    if (req.agent) this.requireAgentRole(config, req.agent);
    const name = (req.name ?? "").trim().slice(0, 60) || config.title;
    const id = newId("lob", 10);
    const grant = await grantForUser(this.deps.db, user.id);
    if (bot && max < 2) throw conflict("lobby_full", "Для хозяина и ИИ нужны два места");
    const botId = await this.deps.db.$transaction(async tx => {
      const limit = grant?.limits.lobbies;
      if (limit != null && await tx.lobby.count({where:{hostId:user.id,status:{not:"closed"}}}) >= limit)
        throw conflict("lobby_quota","Достигнут лимит открытых лобби.");
      await tx.lobby.create({ data: {
        id, name, gameId: config.game, config: config as unknown as Prisma.InputJsonValue, createdByAgent,
        ...(req.agent ? { agent: { ...req.agent } } : {}),
        seats: max, hostId: user.id, members: { create: { userId: user.id, role: "player" } },
      } });
      if (bot) return (await insertBot(tx, id, bot.options, { botInviteHash: sha256(bot.invite) })).userId;
    });
    return { id, botId };
  }

  private requireOpenSeats(row: LobbyRow) {
    if (row.status === "closed") throw conflict("closed", "Лобби закрыто");
    if (row.status === "playing") throw conflict("match_in_progress", "Место можно занять до начала партии");
  }

  private requireCapacity(row: LobbyRow) {
    if (row.members.filter(member => member.role === "player").length >= row.seats)
      throw conflict("lobby_full", "Все места заняты");
  }

  reserveBot(user: UserDto, lobbyId: string, input: BotOptions) {
    const options = botOptions(input);
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      this.requireHost(row, user);
      this.requireOpenSeats(row);
      this.requireCapacity(row);
      const invite = randomString(36);
      const member = await this.deps.db.$transaction(tx => insertBot(tx, lobbyId, options, { botInviteHash: sha256(invite) }));
      const lobby = await this.publishLobby(await this.room(lobbyId));
      return { userId: member.userId, inviteUrl: `${lobby.url}#bot=${invite}` };
    });
  }

  removeBot(user: UserDto, lobbyId: string, userId: string) {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      this.requireHost(row, user);
      this.requireOpenSeats(row);
      const match = row.members.find(member => member.userId === userId && member.botNumber !== null);
      if (!match) throw notFound("Такого ИИ нет в лобби");
      // Retain the number and credential hash so removal also cancels delayed join retries.
      await this.deps.db.lobbyMember.update({ where: { lobbyId_userId: { lobbyId, userId } },
        data: { role: "removed-bot", botInviteHash: null, botControllerId: null } });
      const room = await this.room(lobbyId);
      room.bots.get(userId)?.notify();
      room.bots.delete(userId);
      this.schedule(room);
      return this.publishLobby(room);
    });
  }

  private async authorizeBot(controllerId?: string, actorId?: string) {
    if (!controllerId) {
      if (actorId || (kanameEnabled() ? process.env.KANAME_GUESTS !== "1" : this.deps.env.provisionedAccountsOnly))
        throw forbidden("Для входа нужен личный игровой токен");
      return;
    }
    // mcpIdentity has verified the actual account and its current Kaname assignment.
    // Recheck local token ownership, scope and revocation, including on a resumed long poll.
    const token = await this.deps.db.apiToken.findUnique({ where: { id: controllerId },
      select: { userId: true, revokedAt: true, prefix: true, kanameToken: true } });
    if (!token || token.revokedAt || !token.prefix.startsWith(PLAYER_TOKEN_PREFIX) ||
      token.kanameToken !== kanameEnabled() || (actorId && token.userId !== actorId))
      throw forbidden("Игровой токен недействителен");
  }

  joinBot(link: string, input: BotOptions & { attempt: string }, actor?: UserDto, controllerId?: string) {
    const { lobbyId, invite } = parseBotLink(link, this.deps.env.publicUrl);
    const options = botOptions(input);
    const key = botKey(lobbyId, invite, input.attempt);
    const keyHash = sha256(key);
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      if (controllerId && !actor) throw forbidden("Игровой токен не связан с аккаунтом");
      await this.authorizeBot(controllerId, actor?.id);
      if (row.status === "closed") throw conflict("closed", "Лобби закрыто");
      const existing = await this.deps.db.lobbyMember.findUnique({ where: { botKeyHash: keyHash } });
      let userId: string;
      if (existing) {
        if (existing.role !== "player" || existing.lobbyId !== lobbyId || existing.botControllerId !== (controllerId ?? null)) throw forbidden("Подключение ИИ завершено");
        userId = existing.userId;
      } else {
        this.requireOpenSeats(row);
        if (controllerId && row.members.some(member => member.botControllerId === controllerId))
          throw conflict("bot_already_seated", "Это игровое подключение уже управляет местом в лобби");
        if (invite) {
          const reserved = row.members.find(member => member.botInviteHash === sha256(invite));
          if (!reserved) throw conflict("invalid_bot_invite", "Приглашение на место уже использовано или отменено");
          const claimed = await this.deps.db.lobbyMember.updateMany({
            where: { lobbyId, userId: reserved.userId, botInviteHash: sha256(invite), botKeyHash: null, role: "player" },
            data: { botKeyHash: keyHash, botInviteHash: null, botControllerId: controllerId },
          });
          if (!claimed.count) throw conflict("invalid_bot_invite", "Приглашение на место уже использовано");
          userId = reserved.userId;
        } else {
          this.requireCapacity(row);
          const member = await this.deps.db.$transaction(tx => insertBot(tx, lobbyId, options, { botKeyHash: keyHash, botControllerId: controllerId }));
          userId = member.userId;
        }
      }
      const room = await this.room(lobbyId);
      await this.renewBot(room, userId);
      const lobby = await this.get(lobbyId);
      const member = lobby.members.find(member => member.userId === userId)!;
      return { lobbyId, userId, key, member, url: lobby.url };
    });
  }

  /** A bearer has authority over exactly one seat. Its durable identity has no browser session. */
  private async botMember(lobbyId: string, key: string, controllerId?: string) {
    const member = await this.deps.db.lobbyMember.findUnique({ where: { botKeyHash: sha256(key) },
      include: { lobby: { select: { status: true } } } });
    if (!member || member.lobbyId !== lobbyId || member.role !== "player" || member.botControllerId !== (controllerId ?? null) || member.lobby.status === "closed")
      throw forbidden("Игровое подключение недействительно");
    await this.authorizeBot(controllerId);
    return member;
  }

  async botIdentity(lobbyId: string, key: string, controllerId?: string) { return (await this.botMember(lobbyId, key, controllerId)).userId; }

  async canReadBotAsset(lobbyId: string, key: string, assetId: string, controllerId?: string): Promise<boolean> {
    await this.botMember(lobbyId, key, controllerId);
    const row = await this.loadRow(lobbyId);
    const config = row.config as unknown as ConfigDocument;
    if (config.game !== "quizor" && config.game !== "yomifuda") {
      return collectAssetRefs({ visual: config.visual }).some(ref => ref.assetId === assetId);
    }
    const { view } = await this.botMediaView(lobbyId, key, controllerId);
    const refs = config.game === "quizor" ? quizorMediaRefs(view) : yomifudaMediaRefs(view);
    return refs.some(ref => ref.assetId === assetId);
  }

  botMediaView(lobbyId: string, key: string, controllerId?: string) {
    return this.lock(lobbyId, async () => {
      const userId = await this.botIdentity(lobbyId, key, controllerId);
      const room = await this.room(lobbyId);
      await this.advanceForPlayer(room);
      const seat = this.viewerSeat(room, userId);
      if (!room.match || seat === null) return { gameId: (await this.loadRow(lobbyId)).gameId, view: null, now: this.deps.now() };
      const projected = seatProjection(room.match, seat);
      if (room.match.game.id === "quizor") {
        const quiz = projected.game as { paused?: boolean; resumeAt?: number | null };
        if (room.match.pause || quiz.paused || (quiz.resumeAt != null && projected.now < quiz.resumeAt)) {
          return { gameId: "quizor", view: null, now: projected.now };
        }
      }
      return { gameId: room.match.game.id, view: projected.game as unknown, now: projected.now };
    });
  }

  private async renewBot(room: Room, userId: string) {
    const now = this.deps.now();
    const existing = room.bots.get(userId);
    const connected = existing && existing.expiresAt > now;
    const bot = existing ?? new BotConnection();
    bot.expiresAt = now + BOT_LEASE_MS;
    room.bots.set(userId, bot);
    if (!connected) {
      bot.invalidate();
      await this.syncPresence(room);
      await this.publishLobby(room);
    }
    this.schedule(room);
    return bot;
  }

  private async advanceForPlayer(room: Room, now = this.deps.now()) {
    if (room.match?.advance(now)) {
      await this.afterMatchChange(room);
      this.publishMatch(room);
    }
  }

  private botEvent(room: Room, userId: string, bot: BotConnection, reading: boolean) {
    return bot.current(playerSnapshot(room.match, room.matchId, this.viewerSeat(room, userId), room.seatNames, room.botLobbyState), room.revision, reading);
  }

  async botWait(lobbyId: string, key: string, after: number, timeoutMs: number, signal?: AbortSignal, controllerId?: string) {
    let waitingConnection: BotConnection | undefined;
    const deadline = Date.now() + Math.min(25_000, Math.max(0, timeoutMs));
    const read = async () => this.lock(lobbyId, async () => {
      const member = await this.botMember(lobbyId, key, controllerId);
      const room = await this.room(lobbyId);
      if (waitingConnection && room.bots.get(member.userId) !== waitingConnection)
        throw conflict("bot_disconnected", "Ожидание завершено после отключения игрового места");
      const bot = await this.renewBot(room, member.userId);
      waitingConnection = bot;
      await this.advanceForPlayer(room);
      const event = this.botEvent(room, member.userId, bot, true);
      const instructions = BOT_INSTRUCTIONS[member.botDifficulty as BotDifficulty];
      if (after !== event.cursor) return { result: { event, instructions } };
      const remaining = deadline - Date.now();
      const wait = remaining > 0 && !signal?.aborted ? bot.wait(remaining, signal) : undefined;
      return { result: { event: null, instructions }, wait };
    });
    for (;;) {
      const step = await read();
      if (!step.wait) return step.result;
      await step.wait;
    }
  }

  botAct(lobbyId: string, key: string, cursor: number, action: unknown, controllerId?: string) {
    return this.lock(lobbyId, async () => {
      const member = await this.botMember(lobbyId, key, controllerId);
      const room = await this.room(lobbyId);
      const bot = await this.renewBot(room, member.userId);
      const now = this.deps.now();
      await this.advanceForPlayer(room, now);
      const event = this.botEvent(room, member.userId, bot, false);
      if (!room.match || event.cursor !== cursor || event.kind !== "turn" || event.seat === null)
        throw conflict("stale_agent_event", "Получите актуальное состояние своего места");
      const type = action && typeof action === "object" && "type" in action ? action.type : undefined;
      if (!event.actions.some(form => form.type === type)) throw badRequest("bad_action", "Это действие сейчас недоступно");
      const result = room.match.dispatchPlayer(event.seat, action, now);
      if (!result.ok) throw badRequest(result.error.code, result.error.message);
      bot.invalidate();
      await this.saveLog(room);
      await this.afterMatchChange(room);
      this.publishMatch(room);
    });
  }

  botDetach(lobbyId: string, key: string, controllerId?: string) {
    return this.lock(lobbyId, async () => {
      const member = await this.botMember(lobbyId, key, controllerId);
      const room = await this.room(lobbyId);
      room.bots.get(member.userId)?.notify();
      room.bots.delete(member.userId);
      await this.syncPresence(room);
      this.schedule(room);
      await this.publishLobby(room);
    });
  }

  async saveConfig(user: UserDto, lobbyId: string, name: string): Promise<ConfigDto> {
    if (user.role === "guest") throw forbidden("Сохранить конфиг можно только с аккаунтом");
    const row = await this.deps.db.lobby.findUnique({ where: { id: lobbyId }, select: { hostId: true, config: true } });
    if (!row) throw notFound("Лобби не найдено");
    if (row.hostId !== user.id) throw forbidden("Только хозяин лобби");
    return this.deps.configs.save(user.id, row.config, { name });
  }

  async originalConfig(user: UserDto, lobbyId: string): Promise<ConfigDocument> {
    const row = await this.loadRow(lobbyId);
    this.requireHost(row, user);
    return row.config as unknown as ConfigDocument;
  }

  pause(user: UserDto, lobbyId: string, paused: boolean): Promise<LobbyDto> {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      this.requireHost(row, user);
      const room = await this.room(lobbyId);
      await this.expireAgent(room, this.deps.now());
      if (row.status !== "playing" || !room.match) throw conflict("no_match", "Партия не идёт");
      if (!paused && room.match.pause?.reason === "presenter-disconnected") {
        if (room.presenterId) {
          if (!this.isOnline(room, room.presenterId)) throw conflict("presenter_offline", "Назначенный ведущий должен открыть лобби");
          if (room.agentAssignment?.role === "presenter") await this.clearAgent(room);
        } else if (room.agentAssignment?.role === "presenter" && room.agent.status !== "connected") {
          throw conflict("presenter_offline", "Сначала подключите ведущего или выберите другой способ продолжить");
        }
      }
      await this.applyPause(room, paused ? "manual" : null, this.deps.now());
      return this.publishLobby(room);
    });
  }

  agentAttach(user: UserDto, lobbyId: string, change?: LobbyAgentAssignment): Promise<{ key: string; lobby: LobbyDto }> {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      this.requireHost(row, user);
      if (row.status === "closed") throw conflict("closed", "Лобби закрыто");
      const room = await this.room(lobbyId);
      await this.expireAgent(room, this.deps.now());
      if (room.agent.status === "connected") throw conflict("agent_connected", "Агент уже подключён. Отключите его в лобби для замены");
      const previous = room.agentAssignment;
      const assignment = change?.role === previous?.role && change?.instructions === undefined ? previous : change ?? previous;
      if (!assignment) throw badRequest("agent_role_required", "Выберите роль ИИ");
      this.requireAgentRole(row.config as unknown as ConfigDocument, assignment);
      if (row.status === "playing" && assignment.role !== previous?.role && (assignment.role === "presenter" || previous?.role === "presenter")) {
        throw conflict("match_in_progress", "Во время партии ведущего заменяет хозяин из лобби");
      }
      const changes = [this.deps.db.lobby.update({ where: { id: lobbyId }, data: { agent: { ...assignment } } })];
      if (assignment.role === "presenter" && room.presenterId !== null) {
        if (previous?.role !== "presenter" || room.match?.pause?.reason !== "presenter-disconnected") {
          throw conflict("presenter_assigned", "Сначала снимите действующего ведущего");
        }
        await this.deps.db.$transaction([
          ...changes,
          this.deps.db.lobbyMember.updateMany({ where: { lobbyId, role: "presenter" }, data: { role: "spectator" } }),
        ]);
        room.presenterId = null;
      } else {
        await changes[0];
      }
      room.agentAssignment = assignment;
      const key = room.agent.attach(this.deps.now());
      await this.syncPresence(room);
      this.schedule(room);
      this.publishMatch(room);
      return { key, lobby: await this.publishLobby(room) };
    });
  }

  async agentWait(user: UserDto, lobbyId: string, key: string, after: number, timeoutMs: number, signal?: AbortSignal): Promise<{ event: AgentEvent | null; instructions?: string }> {
    const initial = await this.lock(lobbyId, async () => {
      const room = await this.agentRoom(user, lobbyId, key);
      await this.refreshAgentLease(room);
      const event = room.agent.eventAfter(after);
      return event || timeoutMs === 0
        ? { value: { event: event ?? null, instructions: room.agentAssignment?.instructions } }
        : { pending: room.agent.wait(timeoutMs, signal) };
    });
    if (initial.value) return initial.value;
    await initial.pending;
    return this.lock(lobbyId, async () => {
      const room = await this.agentRoom(user, lobbyId, key);
      if (!signal?.aborted) await this.refreshAgentLease(room);
      return { event: room.agent.eventAfter(after) ?? null, instructions: room.agentAssignment?.instructions };
    });
  }

  agentAct(user: UserDto, lobbyId: string, key: string, cursor: number, action: unknown): Promise<void> {
    return this.lock(lobbyId, async () => {
      const room = await this.agentRoom(user, lobbyId, key);
      const role = room.agentAssignment?.role;
      if (role === "commentator" && isDeepStrictEqual(action, { type: "comment" })) {
        if (!room.agent.comment(cursor, room.matchId)) throw conflict("no_agent_comment", "Комментарий для этого события уже опубликован или недоступен");
        room.agent.renew(this.deps.now());
        this.schedule(room);
        await this.publishLobby(room);
        return;
      }
      if (role !== "presenter" || !room.match) throw forbidden("У роли нет права управлять партией");
      const at = this.deps.now();
      if (room.match.advance(at)) {
        await this.afterMatchChange(room);
        this.publishMatch(room);
      }
      const latest = room.agent.latest;
      if (latest?.cursor !== cursor || !latest.task) throw conflict("stale_agent_event", "Событие изменилось. Запросите текущее состояние");
      if (!latest.task.actions.some((option) => isDeepStrictEqual(option, action))) throw forbidden("Действие недоступно ведущему на этом этапе");
      const result = room.match.dispatchControl("presenter", action, at);
      if (!result.ok) throw conflict(result.error.code, result.error.message);
      room.agent.renew(at);
      await this.saveLog(room);
      await this.afterMatchChange(room);
      this.publishMatch(room);
    });
  }

  agentDetach(user: UserDto, lobbyId: string, key: string): Promise<void> {
    return this.lock(lobbyId, async () => {
      const room = await this.agentRoom(user, lobbyId, key);
      await this.dropAgent(room, this.deps.now());
    });
  }

  manageAgent(user: UserDto, lobbyId: string, command: LobbyAgentCommand): Promise<LobbyDto> {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      this.requireHost(row, user);
      const room = await this.room(lobbyId);
      const role = room.agentAssignment?.role;
      if (!role || row.status === "closed") throw conflict("no_agent", "В лобби нет активной роли ИИ");
      const at = this.deps.now();
      await this.expireAgent(room, at);
      if (command.action === "disconnect") {
        await this.dropAgent(room, at);
        if (row.status === "playing" && role === "presenter") return this.dto(row, room);
        await this.clearAgent(room);
        return this.publishLobby(room);
      }
      if (command.action === "reconnect") {
        if (room.agent.status !== "connected") room.agent.drop("waiting", room.agent.notice);
        return this.publishLobby(room);
      }
      if (role !== "presenter" || room.match?.pause?.reason !== "presenter-disconnected") {
        throw conflict("presenter_not_paused", "Эти действия доступны после отключения ИИ-ведущего");
      }
      if (command.action === "algorithm") {
        if (!room.match.canRecoverAlgorithm()) {
          throw conflict("algorithm_unavailable", "Этот квиз требует решений ведущего");
        }
        const result = room.match.dispatchControl("system", { type: "presenter-algorithm" }, at);
        if (!result.ok) throw conflict(result.error.code, result.error.message);
        await this.deps.db.$transaction([
          this.deps.db.match.update({ where: { id: room.matchId! }, data: { log: room.match.record().log as unknown as Prisma.InputJsonValue } }),
          this.deps.db.lobby.update({ where: { id: lobbyId }, data: { agent: Prisma.DbNull } }),
          this.deps.db.lobbyMember.updateMany({ where: { lobbyId, role: "presenter" }, data: { role: "spectator" } }),
        ]);
        room.presenterId = null;
      } else if (command.action === "human") {
        if (room.seatUsers.includes(command.userId) || !row.members.some((m) => m.userId === command.userId && m.role === "spectator")) {
          throw conflict("presenter_not_spectator", "Выберите зрителя без игрового места");
        }
        if (!this.isOnline(room, command.userId)) throw conflict("presenter_offline", "Зритель должен открыть лобби, чтобы принять ведение");
        await this.deps.db.$transaction([
          this.deps.db.lobbyMember.updateMany({ where: { lobbyId, role: "presenter" }, data: { role: "spectator" } }),
          this.deps.db.lobbyMember.update({ where: { lobbyId_userId: { lobbyId, userId: command.userId } }, data: { role: "presenter" } }),
        ]);
        room.presenterId = command.userId;
        room.agent.drop("disconnected", room.agent.notice);
        this.schedule(room);
        this.publishMatch(room);
        return this.publishLobby(room);
      } else {
        await this.deps.db.$transaction([
          this.deps.db.match.update({ where: { id: room.matchId! }, data: { status: "aborted", finishedAt: new Date(at) } }),
          this.deps.db.lobby.update({ where: { id: lobbyId }, data: { agent: Prisma.DbNull, status: "finished" } }),
          this.deps.db.lobbyMember.updateMany({ where: { lobbyId, role: "presenter" }, data: { role: "spectator" } }),
        ]);
        room.match = null;
        room.presenterId = null;
      }
      room.agentAssignment = null;
      room.agent.drop("disconnected");
      this.schedule(room);
      this.publishMatch(room);
      return this.publishLobby(room);
    });
  }

  private requireHost(row: LobbyRow, user: UserDto): void {
    if (row.hostId !== user.id) throw forbidden("Только хозяин лобби");
  }

  private isOnline(room: Room, userId: string): boolean {
    return [...room.subscribers].some((sub) => sub.userId === userId && !sub.closed?.());
  }

  private requireAgentRole(config: ConfigDocument, assignment: LobbyAgentAssignment): void {
    const game = this.deps.catalog.get(config.game);
    if (!game?.ai?.some((support) => support.role === assignment.role)) throw badRequest("agent_role_unavailable", "Игра не поддерживает эту роль ИИ");
    if (assignment.role === "presenter" && config.game === "quizor") {
      const rules = config.rules as QuizorRules;
      if (rules.presenter === "none") throw badRequest("presenter_disabled", "Включите ведущего в настройках Quizor");
      if (!quizorCanUseAgentPresenter(rules)) throw badRequest("oral_requires_human", "Устные ответы, порученные ведущему, требуют человека. Выберите текстовое поле или другой способ проверки");
    }
  }

  private async agentRoom(user: UserDto, lobbyId: string, key: string): Promise<Room> {
    const room = await this.room(lobbyId);
    if (room.hostId !== user.id) throw forbidden("Только хозяин лобби");
    await this.expireAgent(room, this.deps.now());
    if (!room.agent.hasKey(key)) throw forbidden("Подключение ИИ завершено. Подключитесь снова");
    return room;
  }

  private async expireAgent(room: Room, now: number): Promise<void> {
    const expiresAt = room.agent.expiresAt;
    if (expiresAt !== undefined && expiresAt <= now) await this.dropAgent(room, expiresAt);
  }

  private async refreshAgentLease(room: Room): Promise<void> {
    const now = this.deps.now();
    room.agent.renew(now);
    const match = room.match;
    if (room.agentAssignment?.role === "presenter" && match && !match.pause && match.currentPhase !== "finished"
      && now - (room.agentCheckpointAt ?? match.startedAt) >= AGENT_CHECKPOINT_INTERVAL_MS) {
      const advanced = match.advance(now);
      await this.afterMatchChange(room);
      if (advanced) this.publishMatch(room);
    } else {
      this.schedule(room);
    }
  }

  private async dropAgent(room: Room, at: number): Promise<void> {
    const role = room.agentAssignment?.role;
    const active = room.match && room.match.currentPhase !== "finished";
    const label = { observer: "ИИ-наблюдатель", commentator: "ИИ-комментатор", presenter: "ИИ-ведущий" };
    room.agent.drop("disconnected", role && (!room.match || active) ? `${label[role]} отключился` : undefined);
    if (active && role === "presenter") await this.applyPause(room, "presenter-disconnected", at);
    else this.schedule(room);
    await this.publishLobby(room);
  }

  private async clearAgent(room: Room): Promise<void> {
    await this.deps.db.lobby.update({ where: { id: room.lobbyId }, data: { agent: Prisma.DbNull } });
    room.agentAssignment = null;
  }

  private async applyPause(room: Room, reason: "manual" | "presenter-disconnected" | null, at: number): Promise<void> {
    if (!room.match) return;
    const result = room.match.setPaused(reason, at);
    if (!result.ok && reason !== "presenter-disconnected") throw conflict(result.error.code, result.error.message);
    if (result.ok) await this.saveLog(room);
    if (reason === null) await this.syncPresence(room);
    await this.afterMatchChange(room);
    this.publishMatch(room);
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
      if (me?.role === "presenter" && row.status === "playing") throw conflict("match_in_progress", "Ведущий сохраняет роль до конца партии");
      if (role === "player") {
        if (row.status === "playing") throw conflict("match_in_progress", "Идёт партия: можно смотреть, а сесть — после неё");
        if (players >= row.seats) throw conflict("lobby_full", "Все места заняты");
      } else if (seated) {
        throw conflict("match_in_progress", "Нельзя встать из-за стола посреди партии");
      }
      if (me) await this.deps.db.lobbyMember.update({ where: { lobbyId_userId: { lobbyId, userId: user.id } }, data: { role } });
      else await this.deps.db.lobbyMember.create({ data: { lobbyId, userId: user.id, role,
        guestNumber: user.role === "guest" ? Math.max(0, ...row.members.map((m) => m.guestNumber ?? 0)) + 1 : null } });
      return this.publishLobby(room);
    });
  }

  leave(user: UserDto, lobbyId: string): Promise<LobbyDto> {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      const room = await this.room(lobbyId);
      if (row.hostId === user.id) throw conflict("host_cannot_leave", "Хозяин не уходит, а закрывает лобби");
      if (row.status === "playing" && (room.seatUsers.includes(user.id) || row.members.some(m => m.userId === user.id && m.role === "presenter"))) throw conflict("match_in_progress", "Нельзя уйти посреди партии");
      await this.deps.db.lobbyMember.deleteMany({ where: { lobbyId, userId: user.id } });
      return this.publishLobby(room);
    });
  }

  setPresenter(user: UserDto, lobbyId: string, userId: string | null): Promise<LobbyDto> {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      if (row.hostId !== user.id) throw forbidden("Назначить ведущего может только хозяин");
      if (row.status === "playing") throw conflict("match_in_progress", "Ведущего можно менять только вне партии");
      if (row.status === "closed") throw conflict("closed", "Лобби закрыто");
      const config = row.config as unknown as ConfigDocument;
      if (config.game !== "quizor" || (config.rules as { presenter?: string }).presenter === "none") throw conflict("no_presenter", "В этом квизе ведущий отключён");
      if (userId !== null && (row.agent as LobbyAgentAssignment | null)?.role === "presenter") throw conflict("agent_presenter_assigned", "Сначала снимите ИИ-ведущего");
      const member = row.members.find(m => m.userId === userId);
      if (userId !== null && !member) throw conflict("presenter_not_member", "Ведущий должен сначала войти в лобби");
      if (member?.role === "player") throw conflict("presenter_is_player", "Ведущий не может занимать игровое место: сначала перейдите в зрители");
      await this.deps.db.$transaction(async tx => {
        await tx.lobbyMember.updateMany({ where: { lobbyId, role: "presenter" }, data: { role: "spectator" } });
        if (userId !== null) await tx.lobbyMember.update({ where: { lobbyId_userId: { lobbyId, userId } }, data: { role: "presenter" } });
      });
      const room = await this.room(lobbyId);
      const dto = await this.publishLobby(room);
      this.publishMatch(room);
      return dto;
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
      if (row.members.some(member => member.botNumber !== null && !member.botKeyHash)) {
        throw conflict("bot_reserved", "Сначала подключите ИИ к его месту или снимите резерв");
      }
      const players = row.members.filter((m) => m.role === "player").map((m) => m.userId);
      const room = await this.room(lobbyId);
      await this.expireAgent(room, this.deps.now());
      const aiPresenter = room.agentAssignment?.role === "presenter";
      if (aiPresenter && room.agent.status !== "connected") throw conflict("presenter_offline", "Сначала подключите ИИ-ведущего");
      if (config.game === "quizor" && (config.rules as { presenter?: string }).presenter === "required" && !aiPresenter && !row.members.some(m => m.role === "presenter")) {
        throw conflict("presenter_required", "Для этого квиза назначьте ведущего");
      }
      if (players.length < min || players.length > max) {
        throw conflict("not_enough_players", min === max ? `Нужно ровно ${min} игрока` : `Нужно от ${min} до ${max} игроков`);
      }
      let seatUsers = players;
      const prev = room.seatUsers;
      if (prev.length === players.length && prev.every((u) => players.includes(u))) seatUsers = [...prev.slice(1), ...prev.slice(0, 1)];
      const now = this.deps.now();
      const seed = randomSeed();
      const seatNames = seatUsers.map((id) => this.memberName(row.members.find((m) => m.userId === id)!));
      const match = Match.start({ game, config, seats: seatUsers.length, seed, startedAt: now });
      if (aiPresenter && match.currentPhase === "playing") {
        const result = match.dispatchControl("system", { type: "presenter-presence", online: true, requireAssignment: true }, now);
        if (!result.ok) throw conflict(result.error.code, result.error.message);
      }
      const matchId = newId("mat");
      await this.deps.db.$transaction([
        this.deps.db.match.updateMany({ where: { lobbyId, status: "playing" }, data: { status: "aborted", finishedAt: new Date(now) } }),
        this.deps.db.match.create({
          data: { id: matchId, lobbyId, seed, startedAt: new Date(now), seatUsers, seatNames,
            log: match.record().log as unknown as Prisma.InputJsonValue, status: "playing",
            ...(aiPresenter ? { checkpointAt: new Date(match.checkpointAt) } : {}) },
        }),
        this.deps.db.lobby.update({ where: { id: lobbyId }, data: { status: "playing" } }),
      ]);
      Object.assign(room, { match, matchId, seatUsers, seatNames, finishedSaved: false, hostId: row.hostId, presenterId: row.members.find(m => m.role === "presenter")?.userId ?? null, playerIds: new Set(players), presence: null, presenterOnline: aiPresenter ? true : null });
      room.agentCheckpointAt = aiPresenter ? match.checkpointAt : null;
      room.agent.resetComments();
      await this.syncPresence(room);
      await this.afterMatchChange(room);
      const dto = await this.publishLobby(room);
      this.publishMatch(room);
      return dto;
    });
  }

  close(user: UserDto, lobbyId: string, moderate = false): Promise<LobbyDto> {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      if (row.hostId !== user.id && !(moderate && user.role === "admin")) throw forbidden("Требуются права хозяина или администратора лобби.");
      const room = await this.room(lobbyId);
      const now = new Date(this.deps.now());
      await this.deps.db.$transaction([
        this.deps.db.match.updateMany({ where: { lobbyId, status: "playing" }, data: { status: "aborted", finishedAt: now } }),
        this.deps.db.lobby.update({ where: { id: lobbyId }, data: { status: "closed" } }),
      ]);
      if (room.timer) clearTimeout(room.timer);
      room.timer = null;
      room.match = null;
      room.agent.drop("disconnected");
      for (const bot of room.bots.values()) bot.notify();
      room.bots.clear();
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
      await this.expireAgent(room, now);
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

  control(user: UserDto, lobbyId: string, action: unknown): Promise<DispatchResult> {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      const room = await this.room(lobbyId);
      const role = row.members.some(m => m.userId === user.id && m.role === "presenter") ? "presenter" : row.hostId === user.id ? "host" : null;
      if (!role) return { ok: false, error: { code: "forbidden_control", message: "Управлять могут хозяин и назначенный ведущий" } };
      if (!room.match) return { ok: false, error: { code: "no_match", message: "Партия не идёт" } };
      const now = this.deps.now();
      await this.expireAgent(room, now);
      const advanced = room.match.advance(now);
      const result = room.match.dispatchControl(role, action, now);
      if (result.ok) await this.saveLog(room);
      if (result.ok || advanced) { await this.afterMatchChange(room); this.publishMatch(room); }
      return result;
    });
  }

  private async saveLog(room: Room): Promise<void> {
    if (room.match && room.matchId) await this.deps.db.match.update({ where: { id: room.matchId }, data: { log: room.match.record().log as unknown as Prisma.InputJsonValue } });
  }

  private async syncPresence(room: Room): Promise<void> {
    const match = room.match;
    if (!match?.game.applyControl || match.pause) return;
    const canSync = () => match.currentPhase === "playing" || (match.currentPhase === "intermission" && match.game.applyIntermissionControl);
    if (!canSync()) return;
    const advanced = match.advance(this.deps.now());
    if (!canSync()) {
      if (advanced) { await this.afterMatchChange(room); this.publishMatch(room); }
      return;
    }
    const online = new Set([...room.subscribers].filter(sub => !sub.closed?.()).map(sub => sub.userId));
    for (const [id, bot] of room.bots) if (bot.expiresAt > this.deps.now()) online.add(id);
    const seats = new Set(room.seatUsers.flatMap((id, seat) => online.has(id) ? [seat] : []));
    let changed = advanced;
    for (let seat = 0; seat < room.seatUsers.length; seat++) {
      if (room.presence !== null && room.presence.has(seat) === seats.has(seat)) continue;
      const result = match.dispatchControl("system", { type: "presence", seat, online: seats.has(seat) }, this.deps.now());
      changed ||= result.ok;
    }
    const presenterOnline = (room.agentAssignment?.role === "presenter" && room.agent.status === "connected") || (room.presenterId !== null && online.has(room.presenterId));
    if (room.presenterOnline !== presenterOnline) {
      const result = match.dispatchControl("system", { type: "presenter-presence", online: presenterOnline, ...(presenterOnline ? { requireAssignment: true } : {}) }, this.deps.now());
      changed ||= result.ok;
    }
    room.presenterOnline = presenterOnline;
    room.presence = seats;
    if (changed) { await this.saveLog(room); await this.afterMatchChange(room); this.publishMatch(room); }
  }

  // ---------- live updates ----------

  async subscribe(sub: Subscriber, lobbyId: string): Promise<void> {
    await this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      const room = await this.room(lobbyId);
      if (sub.closed?.()) return; // the socket went away while we waited for the lock
      room.subscribers.add(sub);
      room.hostId = row.hostId;
      room.presenterId = row.members.find(m => m.role === "presenter")?.userId ?? null;
      room.playerIds = new Set(row.members.filter(member => member.role === "player").map(member => member.userId));
      await this.syncPresence(room);
      sub.send({ type: "lobby", lobby: this.dto(await this.loadRow(lobbyId), room) });
      this.sendMatch(room, sub);
    });
  }

  unsubscribe(sub: Subscriber, lobbyId?: string): void {
    const rooms = lobbyId ? [this.rooms.get(lobbyId)] : [...this.rooms.values()];
    for (const room of rooms) if (room) {
      room.subscribers.delete(sub);
      void this.lock(room.lobbyId, async () => {
        room.subscribers.delete(sub);
        await this.syncPresence(room);
      }).catch(e => this.deps.log.error({ err: e, lobbyId: room.lobbyId }, "presence update failed"));
    }
  }

  private async publishLobby(room: Room): Promise<LobbyDto> {
    const row = await this.loadRow(room.lobbyId);
    room.hostId = row.hostId;
    room.presenterId = row.members.find(m => m.role === "presenter")?.userId ?? null;
    room.playerIds = new Set(row.members.filter(member => member.role === "player").map(member => member.userId));
    room.botMemberIds = new Set(row.members.filter(member => member.botNumber !== null).map(member => member.userId));
    const dto = this.dto(row, room);
    room.botLobbyState = { name: dto.name, gameId: dto.gameId, status: dto.status, seats: dto.seats,
      summary: dto.information.summary, members: dto.members };
    for (const bot of room.bots.values()) bot.notify();
    for (const sub of room.subscribers) sub.send({ type: "lobby", lobby: dto });
    return dto;
  }

  private viewerSeat(room: Room, userId: string): number | null {
    const seat = room.seatUsers.indexOf(userId);
    return room.match && room.playerIds.has(userId) && seat >= 0 ? seat : null;
  }

  private sendMatch(room: Room, sub: Subscriber) {
    const seat = this.viewerSeat(room, sub.userId);
    const controlRole = room.presenterId === sub.userId ? "presenter" : room.hostId === sub.userId ? "host" : undefined;
    const match = room.match ? room.match.view(seat, controlRole) : null;
    if (match && room.match?.game.video) this.rememberVideo(room.lobbyId, sub.userId, room.match.game.video.directives(match.game));
    sub.send({ type: "match", lobbyId: room.lobbyId, match, seat, controlRole, serverTime: this.deps.now() });
  }

  /** The last directives a viewer was shown stay fetchable: reconnects and pauses keep the scene. */
  private rememberVideo(lobbyId: string, userId: string, directives: VideoDirective[]) {
    if (!directives.length) return;
    const id = `${lobbyId}\n${userId}`;
    const seen = this.videoSeen.get(id) ?? new Map<string, VideoDirective>();
    for (const directive of directives) {
      seen.delete(directive.key);
      seen.set(directive.key, directive);
    }
    while (seen.size > VIDEO_WINDOW) seen.delete(seen.keys().next().value!);
    this.videoSeen.delete(id);
    this.videoSeen.set(id, seen);
    while (this.videoSeen.size > VIDEO_VIEWERS) this.videoSeen.delete(this.videoSeen.keys().next().value!);
  }

  /** Files of slices a user was given; `/files/video` serves nothing else. */
  allowVideoFiles(userId: string, files: string[]) {
    const allowed = this.videoFiles.get(userId) ?? new Set<string>();
    for (const file of files) {
      allowed.delete(file);
      allowed.add(file);
    }
    while (allowed.size > 4096) allowed.delete(allowed.values().next().value!);
    this.videoFiles.delete(userId);
    this.videoFiles.set(userId, allowed);
    while (this.videoFiles.size > VIDEO_VIEWERS) this.videoFiles.delete(this.videoFiles.keys().next().value!);
  }

  canReadVideoFile(userId: string, name: string): boolean {
    return this.videoFiles.get(userId)?.has(name) ?? false;
  }

  /**
   * A directive the viewer may fetch: in the viewer's current view (the same seat rule
   * as match messages; presenter secrets only for the presenter) or among the last 16
   * shown to them in this lobby. Names of seats replace player placeholders.
   */
  async videoAccess(userId: string, lobbyId: string, key: string): Promise<{ directive: VideoDirective; names: Record<string, string> }> {
    const room = await this.room(lobbyId);
    const game = room.match?.game;
    if (!room.match || !game?.video) throw notFound("В этом лобби нет видео");
    const controlRole = room.presenterId === userId ? "presenter" : room.hostId === userId ? "host" : undefined;
    const member = room.playerIds.has(userId) || controlRole !== undefined
      || (await this.deps.db.lobbyVisit.findUnique({ where: { lobbyId_userId: { lobbyId, userId } } })) !== null;
    if (!member) throw forbidden("Сначала откройте лобби");
    const seat = this.viewerSeat(room, userId);
    const projection = seat !== null && room.botMemberIds.has(userId)
      ? seatProjection(room.match, seat).game : room.match.view(seat, controlRole).game;
    const current = game.video.directives(projection);
    this.rememberVideo(lobbyId, userId, current);
    const directive = this.videoSeen.get(`${lobbyId}\n${userId}`)?.get(key);
    if (!directive) throw forbidden("Эта сцена пока не показана");
    const names = Object.fromEntries(room.seatNames.map((name, seat) => [`seat-${seat}`, name]));
    return { directive, names };
  }

  private publishMatch(room: Room) {
    room.revision++;
    room.agent.publish(room.agentAssignment?.role, room.matchId, room.match);
    for (const bot of room.bots.values()) bot.notify();
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
    } else if (room.agentAssignment?.role === "presenter" && room.agentCheckpointAt !== match.checkpointAt) {
      await this.deps.db.match.update({ where: { id: room.matchId! }, data: { checkpointAt: new Date(match.checkpointAt) } });
      room.agentCheckpointAt = match.checkpointAt;
    }
    this.schedule(room);
  }

  private schedule(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    let at = Math.min(room.match?.nextWakeAt() ?? Infinity, room.agent.expiresAt ?? Infinity);
    for (const bot of room.bots.values()) at = Math.min(at, bot.expiresAt);
    if (!Number.isFinite(at)) return;
    const delay = Math.min(Math.max(0, at - this.deps.now()), MAX_TIMER_MS);
    room.timer = setTimeout(() => void this.wake(room.lobbyId), delay);
    room.timer.unref?.();
  }

  private wake(lobbyId: string): Promise<void> {
    return this.lock(lobbyId, async () => {
      const room = this.rooms.get(lobbyId);
      if (!room) return;
      const now = this.deps.now();
      await this.expireAgent(room, now);
      let disconnected = false;
      for (const [id, bot] of room.bots) {
        if (bot.expiresAt > now) continue;
        bot.notify();
        room.bots.delete(id);
        disconnected = true;
      }
      if (disconnected) { await this.syncPresence(room); await this.publishLobby(room); }
      if (!room.match) { this.schedule(room); return; }
      const changed = room.match.advance(now);
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
          const aiPresenter = room.agentAssignment?.role === "presenter";
          const restoreAt = aiPresenter
            ? Math.max(row.checkpointAt?.getTime() ?? record.startedAt, record.log.at(-1)?.at ?? record.startedAt)
            : this.deps.now();
          const match = Match.restore({ game, config, record, now: restoreAt });
          Object.assign(room, { match, matchId: row.id, seatUsers, seatNames: row.seatNames as string[], finishedSaved: false, presence: null, presenterOnline: null });
          room.agentCheckpointAt = row.checkpointAt?.getTime() ?? null;
          if (room.agentAssignment) await this.dropAgent(room, restoreAt);
          await this.syncPresence(room);
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
    for (const room of this.rooms.values()) {
      if (room.timer) clearTimeout(room.timer);
      room.agent.drop("disconnected");
      for (const bot of room.bots.values()) bot.notify();
      room.bots.clear();
    }
    this.rooms.clear();
  }
}
