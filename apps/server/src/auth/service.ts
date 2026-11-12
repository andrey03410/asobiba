import type { InviteDto, Role, TokenDto, UserDto } from "@asobiba/api";
import type { User } from "../generated/prisma/client";
import bcrypt from "bcryptjs";
import type { Db } from "../db";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../http-errors";
import { newId, randomString, sha256 } from "../ids";

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const LOGIN_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;
const DUMMY_HASH = bcrypt.hashSync("asobiba-dummy-password", 10);

export function userDto(user: Pick<User, "id" | "login" | "role" | "displayName">): UserDto {
  return { id: user.id, login: user.displayName ?? user.login, role: user.role === "guest" ? "guest" : user.role === "admin" ? "admin" : "user" };
}

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

function checkCredentials(login: string, password: string) {
  if (!LOGIN_RE.test(login)) throw badRequest("bad_login", "Логин: 3–24 символа, буквы, цифры, точка, дефис, подчёркивание");
  if (password.length < 8 || password.length > 200) throw badRequest("bad_password", "Пароль: от 8 символов");
}

export class AuthService {
  private readonly sessionLocks = new Map<string, Promise<unknown>>();
  private readonly watchers = new Map<string, Set<() => void>>();
  private readonly guestAttempts = new Map<string, { until: number; result: Promise<{ user: UserDto; token: string }> }>();

  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  /** Serialize guest membership changes, moves and logout against the same session. */
  async withSession<T>(token: string | undefined, fn: (user: UserDto | null) => Promise<T>): Promise<T> {
    const key = sha256(token ?? "");
    const previous = this.sessionLocks.get(key) ?? Promise.resolve();
    const result = previous.then(async () => fn(await this.userBySession(token)));
    const tail = result.then(() => undefined, () => undefined);
    this.sessionLocks.set(key, tail);
    void tail.then(() => { if (this.sessionLocks.get(key) === tail) this.sessionLocks.delete(key); });
    return result;
  }

  /** A retry key only replays creation while its original session is still alive. */
  async createGuest(nameInput: string, attempt: string): Promise<{ user: UserDto; token: string }> {
    const name = nameInput.trim();
    if ([...name].length < 1 || [...name].length > 24 || !/^[\p{L}\p{M}\p{N} ._-]+$/u.test(name)) {
      throw badRequest("bad_guest_name", "Имя: от 1 до 24 символов, буквы, цифры, пробел, точка, дефис и подчёркивание");
    }
    const key = sha256(attempt);
    for (const [id, value] of this.guestAttempts) if (value.until <= this.now()) this.guestAttempts.delete(id);
    const cached = this.guestAttempts.get(key);
    if (cached) {
      const result = await cached.result;
      if (!(await this.userBySession(result.token))) throw conflict("guest_attempt_ended", "Гостевая сессия завершена. Откройте приглашение заново");
      return result;
    }
    const result = (async () => {
      const id = newId("usr");
      const row = await this.db.user.create({ data: { id, login: `@guest:${id}`, displayName: name, role: "guest" } });
      const session = await this.createSession(id);
      return { user: userDto(row), token: session.token };
    })();
    this.guestAttempts.set(key, { until: this.now() + 10 * 60_000, result });
    try { return await result; } catch (error) { this.guestAttempts.delete(key); throw error; }
  }

  /** Notify already-open connections immediately; the return value removes the listener. */
  watchSession(token: string, onEnd: () => void): () => void {
    const key = sha256(token);
    const watchers = this.watchers.get(key) ?? new Set<() => void>();
    watchers.add(onEnd);
    this.watchers.set(key, watchers);
    return () => { watchers.delete(onEnd); if (!watchers.size) this.watchers.delete(key); };
  }

  async sessionExpiresAt(token: string): Promise<number | null> {
    const row = await this.db.session.findUnique({ where: { id: sha256(token) } });
    return row?.expiresAt.getTime() ?? null;
  }

  async createUser(input: { login: string; password: string; role?: Role }): Promise<UserDto> {
    const login = normalizeLogin(input.login);
    checkCredentials(login, input.password);
    if (await this.db.user.findUnique({ where: { login } })) throw conflict("login_taken", "Такой логин уже занят");
    const user = await this.db.user.create({
      data: { id: newId("usr"), login, passwordHash: await bcrypt.hash(input.password, 10), role: input.role ?? "user" },
    });
    return userDto(user);
  }

  async register(input: { login: string; password: string; invite: string }): Promise<UserDto> {
    const login = normalizeLogin(input.login);
    checkCredentials(login, input.password);
    const invite = await this.db.invite.findUnique({ where: { codeHash: sha256(input.invite.trim()) } });
    if (!invite || invite.usedAt || invite.expiresAt.getTime() < Date.now()) {
      throw badRequest("bad_invite", "Приглашение недействительно или уже использовано");
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    return this.db.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { login } })) throw conflict("login_taken", "Такой логин уже занят");
      const user = await tx.user.create({ data: { id: newId("usr"), login, passwordHash, role: invite.role } });
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date(), usedById: user.id },
      });
      if (claimed.count !== 1) throw badRequest("bad_invite", "Приглашение уже использовано");
      return userDto(user);
    });
  }

  async verifyPassword(loginInput: string, password: string): Promise<UserDto> {
    const user = await this.db.user.findUnique({ where: { login: normalizeLogin(loginInput) } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || user.role === "guest" || !ok) throw unauthorized("Неверный логин или пароль");
    return userDto(user);
  }

  // ---------- sessions ----------

  async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = `ses_${randomString(40)}`;
    const expiresAt = new Date(this.now() + SESSION_TTL_MS);
    await this.db.session.create({ data: { id: sha256(token), userId, expiresAt } });
    return { token, expiresAt };
  }

  async userBySession(token: string | undefined): Promise<UserDto | null> {
    if (!token) return null;
    const session = await this.db.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
    if (!session || session.expiresAt.getTime() <= this.now()) return null;
    return userDto(session.user);
  }

  async deleteSession(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.db.session.deleteMany({ where: { id: sha256(token) } });
    for (const notify of this.watchers.get(sha256(token)) ?? []) notify();
  }

  // ---------- invites ----------

  async createInvite(createdById: string | null, role: Role = "user"): Promise<{ invite: InviteDto; code: string }> {
    const code = randomString(24);
    const invite = await this.db.invite.create({
      data: { id: newId("inv"), codeHash: sha256(code), role, createdById, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      include: { usedBy: true },
    });
    return { invite: inviteDto(invite), code };
  }

  async checkInvite(code: string): Promise<{ valid: boolean; role: Role | null }> {
    const invite = await this.db.invite.findUnique({ where: { codeHash: sha256(code.trim()) } });
    const valid = !!invite && !invite.usedAt && invite.expiresAt.getTime() > Date.now();
    return { valid, role: valid && invite ? (invite.role as Role) : null };
  }

  async listInvites(): Promise<InviteDto[]> {
    const invites = await this.db.invite.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { usedBy: true } });
    return invites.map(inviteDto);
  }

  // ---------- personal MCP tokens ----------

  async createToken(userId: string, name: string): Promise<{ token: TokenDto; secret: string }> {
    if ((await this.db.user.findUnique({ where: { id: userId } }))?.role === "guest") throw forbidden("Для агента нужен аккаунт");
    const clean = name.trim().slice(0, 60) || "Агент";
    const secret = `asb_${randomString(40)}`;
    const count = await this.db.apiToken.count({ where: { userId, revokedAt: null } });
    if (count >= 20) throw conflict("too_many_tokens", "Слишком много токенов: отзовите ненужные");
    const token = await this.db.apiToken.create({
      data: { id: newId("tok"), userId, name: clean, tokenHash: sha256(secret), prefix: secret.slice(0, 10) },
    });
    return { token: tokenDto(token), secret };
  }

  async userByToken(secret: string | undefined): Promise<UserDto | null> {
    if (!secret?.startsWith("asb_")) return null;
    const token = await this.db.apiToken.findUnique({ where: { tokenHash: sha256(secret) }, include: { user: true } });
    if (!token || token.revokedAt || token.user.role === "guest") return null;
    if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000) {
      await this.db.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
    }
    return userDto(token.user);
  }

  async listTokens(userId: string): Promise<TokenDto[]> {
    const tokens = await this.db.apiToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return tokens.map(tokenDto);
  }

  async revokeToken(userId: string, id: string): Promise<void> {
    const res = await this.db.apiToken.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (res.count === 0) throw notFound("Токен не найден");
  }
}

function inviteDto(invite: {
  id: string;
  role: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  usedBy: { login: string } | null;
}): InviteDto {
  return {
    id: invite.id,
    role: invite.role === "admin" ? "admin" : "user",
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
    usedAt: invite.usedAt?.toISOString() ?? null,
    usedBy: invite.usedBy?.login ?? null,
  };
}

function tokenDto(token: { id: string; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null }): TokenDto {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
  };
}
