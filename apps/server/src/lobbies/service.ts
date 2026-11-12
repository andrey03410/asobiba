import type { CreateLobbyRequest, LobbyDto, LobbyInvitationDto, LobbyStatus, LobbySummaryDto, ServerMessage, UserDto } from "@asobiba/api";
import { collectAssetRefs, type ConfigDocument, type DispatchResult, type GameCatalog, Match, type MatchLogEntry, type MatchRecord } from "@asobiba/sdk";
import type { Prisma } from "../generated/prisma/client";
import type { ConfigService } from "../configs/service";
import type { Db } from "../db";
import type { Env } from "../env";
import { quizorMediaRefs } from "../games/media-refs";
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
  seatNames: string[];
  finishedSaved: boolean;
  subscribers: Set<Subscriber>;
  timer: NodeJS.Timeout | null;
  hostId: string;
  presenterId: string | null;
  playerIds: Set<string>;
  presence: Set<number> | null;
  presenterOnline: boolean | null;
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
    const lobby = await this.deps.db.lobby.findUnique({ where: { id: lobbyId }, select: { id: true, hostId: true, status: true, config: true, members: { select: { userId: true, role: true } } } });
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
      seatNames: room?.seatNames ?? [],
      members: row.members.map((m) => {
        const seat = seatUsers.indexOf(m.userId);
        return {
          userId: m.userId,
          login: this.memberName(m),
          role: m.role === "player" ? "player" : m.role === "presenter" ? "presenter" : "spectator",
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

  private memberName(member: LobbyRow["members"][number]): string {
    return member.user.role === "guest" ? `${member.user.displayName} · гость ${member.guestNumber}` : member.user.login;
  }

  async invitation(lobbyId: string): Promise<LobbyInvitationDto> {
    const row = await this.loadRow(lobbyId);
    return { id: row.id, name: row.name, gameTitle: this.deps.catalog.get(row.gameId)?.title ?? row.gameId,
      host: row.host.login, status: row.status as LobbyStatus,
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
      if (config.game !== "quizor") continue;
      const room = await this.room(row.id);
      // Presenter secrets are deliberately excluded: a known future file stays closed.
      const view = room.match?.view(this.viewerSeat(room, userId));
      if (view && quizorMediaRefs(view.game).some(ref => ref.assetId === assetId)) return true;
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
    if (user.role === "guest") throw forbidden("Создать лобби можно только с аккаунтом");
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
      const players = row.members.filter((m) => m.role === "player").map((m) => m.userId);
      if (config.game === "quizor" && (config.rules as { presenter?: string }).presenter === "required" && !row.members.some(m => m.role === "presenter")) {
        throw conflict("presenter_required", "Для этого квиза назначьте ведущего");
      }
      if (players.length < min || players.length > max) {
        throw conflict("not_enough_players", min === max ? `Нужно ровно ${min} игрока` : `Нужно от ${min} до ${max} игроков`);
      }
      const room = await this.room(lobbyId);
      let seatUsers = players;
      const prev = room.seatUsers;
      if (prev.length === players.length && prev.every((u) => players.includes(u))) seatUsers = [...prev.slice(1), ...prev.slice(0, 1)];
      const now = this.deps.now();
      const seed = randomSeed();
      const seatNames = seatUsers.map((id) => this.memberName(row.members.find((m) => m.userId === id)!));
      const match = Match.start({ game, config, seats: seatUsers.length, seed, startedAt: now });
      const matchId = newId("mat");
      await this.deps.db.$transaction([
        this.deps.db.match.updateMany({ where: { lobbyId, status: "playing" }, data: { status: "aborted", finishedAt: new Date(now) } }),
        this.deps.db.match.create({
          data: { id: matchId, lobbyId, seed, startedAt: new Date(now), seatUsers, seatNames, log: [], status: "playing" },
        }),
        this.deps.db.lobby.update({ where: { id: lobbyId }, data: { status: "playing" } }),
      ]);
      Object.assign(room, { match, matchId, seatUsers, seatNames, finishedSaved: false, hostId: row.hostId, presenterId: row.members.find(m => m.role === "presenter")?.userId ?? null, playerIds: new Set(players), presence: null, presenterOnline: null });
      await this.syncPresence(room);
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

  control(user: UserDto, lobbyId: string, action: unknown): Promise<DispatchResult> {
    return this.lock(lobbyId, async () => {
      const row = await this.loadRow(lobbyId);
      const room = await this.room(lobbyId);
      const role = row.members.some(m => m.userId === user.id && m.role === "presenter") ? "presenter" : row.hostId === user.id ? "host" : null;
      if (!role) return { ok: false, error: { code: "forbidden_control", message: "Управлять могут хозяин и назначенный ведущий" } };
      if (!room.match) return { ok: false, error: { code: "no_match", message: "Партия не идёт" } };
      const now = this.deps.now();
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
    if (!room.match?.game.applyControl || room.match.currentPhase !== "playing") return;
    const advanced = room.match.advance(this.deps.now());
    if (room.match.currentPhase !== "playing") {
      if (advanced) { await this.afterMatchChange(room); this.publishMatch(room); }
      return;
    }
    const online = new Set([...room.subscribers].filter(sub => !sub.closed?.()).map(sub => sub.userId));
    const seats = new Set(room.seatUsers.flatMap((id, seat) => online.has(id) ? [seat] : []));
    let changed = advanced;
    for (let seat = 0; seat < room.seatUsers.length; seat++) {
      if (room.presence !== null && room.presence.has(seat) === seats.has(seat)) continue;
      const result = room.match.dispatchControl("system", { type: "presence", seat, online: seats.has(seat) }, this.deps.now());
      changed ||= result.ok;
    }
    const presenterOnline = room.presenterId !== null && online.has(room.presenterId);
    if (room.presenterOnline !== presenterOnline) {
      const result = room.match.dispatchControl("system", { type: "presenter-presence", online: presenterOnline }, this.deps.now());
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
    const dto = this.dto(row, room);
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
    sub.send({ type: "match", lobbyId: room.lobbyId, match: room.match ? room.match.view(seat, controlRole) : null, seat, controlRole, serverTime: this.deps.now() });
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
          Object.assign(room, { match, matchId: row.id, seatUsers, seatNames: row.seatNames as string[], finishedSaved: false, presence: null, presenterOnline: null });
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
    for (const room of this.rooms.values()) if (room.timer) clearTimeout(room.timer);
    this.rooms.clear();
  }
}
