import { createReadStream } from "node:fs";
import type { ClientMessage, CreateLobbyRequest, ServerMessage, UserDto } from "@asobiba/api";
import { describeGame, listGames } from "@asobiba/sdk";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Services } from "./app";
import { FailureLimiter } from "./auth/rate-limit";
import { SESSION_TTL_MS } from "./auth/service";
import type { AssetBody } from "./assets/service";
import { MAX_MEDIA_BYTES, parseFileRange } from "./assets/media";
import { badRequest, forbidden, HttpError, notFound, unauthorized } from "./http-errors";
import type { Subscriber } from "./lobbies/service";

export const SESSION_COOKIE = "asobiba_session";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const res = schema.safeParse(value);
  if (!res.success) {
    const issue = res.error.issues[0];
    throw badRequest("bad_request", `${issue?.path.join(".") || "тело"}: ${issue?.message ?? "неверный запрос"}`);
  }
  return res.data;
}

export function requireUser(req: FastifyRequest): UserDto {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireAccount(req: FastifyRequest): UserDto {
  const user = requireUser(req);
  if (user.role === "guest") throw forbidden("Для этого нужен аккаунт");
  return user;
}

function requireAdmin(req: FastifyRequest): UserDto {
  const user = requireAccount(req);
  if (user.role !== "admin") throw forbidden("Только для админа");
  return user;
}

const idParam = z.object({ id: z.string().min(1).max(80) });

export function registerRoutes(app: FastifyInstance, s: Services): void {
  const setCookie = (reply: FastifyReply, token: string) => {
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: s.env.cookieSecure,
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  };

  const setSession = async (reply: FastifyReply, userId: string) => setCookie(reply, (await s.auth.createSession(userId)).token);
  const withUser = <T>(req: FastifyRequest, fn: (user: UserDto) => Promise<T>) =>
    s.auth.withSession(req.cookies[SESSION_COOKIE], async (user) => {
      if (!user) throw unauthorized();
      return fn(user);
    });

  // ---------- auth ----------
  app.post("/api/auth/register", async (req, reply) => {
    if (req.user) throw new HttpError(409, "already_signed_in", "Сначала выйдите из текущей сессии");
    const body = parse(z.object({ login: z.string(), password: z.string(), invite: z.string() }), req.body);
    const user = await s.auth.register(body);
    await setSession(reply, user.id);
    reply.code(201);
    return { user };
  });

  // failed logins: 10 per account and 30 per address in 15 minutes
  const perLogin = new FailureLimiter(10, 15 * 60_000, s.now);
  const perIp = new FailureLimiter(30, 15 * 60_000, s.now);
  app.post("/api/auth/login", async (req, reply) => {
    if (req.user) throw new HttpError(409, "already_signed_in", "Сначала выйдите из текущей сессии");
    const body = parse(z.object({ login: z.string().max(64), password: z.string().max(256) }), req.body);
    const loginKey = [body.login.trim().toLowerCase()];
    const ipKey = [req.ip];
    perLogin.check(loginKey);
    perIp.check(ipKey);
    let user: UserDto;
    try {
      user = await s.auth.verifyPassword(body.login, body.password);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        perLogin.fail(loginKey);
        perIp.fail(ipKey);
      }
      throw e;
    }
    perLogin.reset(loginKey);
    await setSession(reply, user.id);
    return { user };
  });

  const guestLimit = new FailureLimiter(30, 15 * 60_000, s.now);
  app.post("/api/auth/guest", async (req, reply) => {
    const body = parse(z.object({ name: z.string().max(200), lobbyId: z.string().min(1).max(80),
      role: z.enum(["player", "spectator"]), attempt: z.string().regex(/^[a-zA-Z0-9_-]{32,80}$/) }), req.body);
    if (req.user) return withUser(req, async (user) => {
      await s.lobbies.visit(user, body.lobbyId);
      return { user, lobby: await s.lobbies.join(user, body.lobbyId, body.role) };
    });
    const invitation = await s.lobbies.invitation(body.lobbyId);
    if (invitation.status === "closed") throw new HttpError(409, "closed", "Лобби закрыто");
    guestLimit.check([req.ip]);
    guestLimit.fail([req.ip]);
    const created = await s.auth.createGuest(body.name, body.attempt);
    setCookie(reply, created.token);
    return s.auth.withSession(created.token, async (user) => {
      if (!user) throw unauthorized();
      await s.lobbies.visit(user, body.lobbyId);
      return { user, lobby: await s.lobbies.join(user, body.lobbyId, body.role) };
    });
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const body = parse(z.object({ confirmActive: z.boolean().optional() }).optional(), req.body);
    await s.auth.withSession(req.cookies[SESSION_COOKIE], async (user) => {
      if (user?.role === "guest") await s.lobbies.endGuest(user.id, body?.confirmActive ?? false);
      await s.auth.deleteSession(req.cookies[SESSION_COOKIE]);
    });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.code(204);
  });

  app.get("/api/me", async (req) => ({ user: req.user }));

  app.get("/api/invites/check/:code", async (req) => s.auth.checkInvite(parse(z.object({ code: z.string().max(100) }), req.params).code));

  app.post("/api/invites", async (req, reply) => {
    const admin = requireAdmin(req);
    const body = parse(z.object({ role: z.enum(["user", "admin"]).optional() }).optional(), req.body);
    const { invite, code } = await s.auth.createInvite(admin.id, body?.role ?? "user");
    reply.code(201);
    return { invite, code, url: `${s.env.publicUrl}/register?invite=${code}` };
  });

  app.get("/api/invites", async (req) => {
    requireAdmin(req);
    return { invites: await s.auth.listInvites() };
  });

  // ---------- MCP tokens ----------
  const mcpUrl = `${s.env.publicUrl}/mcp`;
  app.get("/api/tokens", async (req) => ({ tokens: await s.auth.listTokens(requireAccount(req).id), mcpUrl }));
  app.post("/api/tokens", async (req, reply) => {
    const user = requireAccount(req);
    const body = parse(z.object({ name: z.string().max(60) }), req.body);
    const { token, secret } = await s.auth.createToken(user.id, body.name);
    reply.code(201);
    return { token, secret, mcpUrl };
  });
  app.delete("/api/tokens/:id", async (req, reply) => {
    await s.auth.revokeToken(requireAccount(req).id, parse(idParam, req.params).id);
    reply.code(204);
  });

  // ---------- games ----------
  app.get("/api/games", async (req) => {
    requireAccount(req);
    return { games: listGames(s.catalog) };
  });
  app.get("/api/games/:id", async (req) => {
    requireAccount(req);
    const game = s.catalog.get(parse(idParam, req.params).id);
    if (!game) throw notFound("Игра не найдена");
    return { game: describeGame(game) };
  });

  // ---------- configs ----------
  app.post("/api/configs/validate", async (req) => {
    const user = requireAccount(req);
    const body = parse(z.object({ config: z.unknown() }), req.body);
    return s.configs.validate(user.id, body.config);
  });
  app.get("/api/configs", async (req) => ({ configs: await s.configs.list(requireAccount(req).id) }));
  app.post("/api/configs", async (req, reply) => {
    const user = requireAccount(req);
    const body = parse(z.object({ config: z.unknown() }), req.body);
    const config = await s.configs.save(user.id, body.config);
    reply.code(201);
    return { config };
  });
  app.put("/api/configs/:id", async (req) => {
    const user = requireAccount(req);
    const body = parse(z.object({ config: z.unknown() }), req.body);
    return { config: await s.configs.save(user.id, body.config, parse(idParam, req.params).id) };
  });
  app.delete("/api/configs/:id", async (req, reply) => {
    await s.configs.remove(requireAccount(req).id, parse(idParam, req.params).id);
    reply.code(204);
  });

  // ---------- assets ----------
  app.get("/api/assets", async (req) => ({ assets: await s.assets.list(requireAccount(req).id) }));
  // Only these two routes opt into raw streams. JSON elsewhere keeps its 2 MiB parser limit.
  void app.register(async (uploads) => {
    uploads.removeAllContentTypeParsers();
    uploads.addContentTypeParser("*", (_req, payload, done) => done(null, payload));
    const body = (req: FastifyRequest): AssetBody => {
      const declared = Number(req.headers["content-length"] ?? 0);
      if (declared > MAX_MEDIA_BYTES) throw new HttpError(413, "too_big", "Файл больше 1 ГиБ");
      return (req.body ?? Buffer.alloc(0)) as AssetBody;
    };
    uploads.post("/api/assets", async (req, reply) => {
      const user = requireAccount(req);
      const query = parse(z.object({ name: z.string().max(200).optional() }), req.query);
      const asset = await s.assets.save(user.id, { name: query.name, body: body(req), source: "upload" });
      return reply.code(201).send({ asset });
    });
    uploads.put("/api/uploads/:ticket", async (req, reply) => {
      const { ticket } = parse(z.object({ ticket: z.string().startsWith("upl_").max(80) }), req.params);
      const asset = await s.assets.finishUpload(ticket, body(req));
      return reply.code(201).send({ asset });
    });
  });
  app.delete("/api/assets/:id", async (req, reply) => {
    await s.assets.remove(requireAccount(req).id, parse(idParam, req.params).id);
    reply.code(204);
  });
  app.route({ method: ["GET", "HEAD"], url: "/files/assets/:id", handler: async (req, reply) => {
    const user = requireUser(req);
    const assetId = parse(idParam, req.params).id;
    const file = await s.assets.file(assetId);
    if (!file) throw notFound("Файл не найден");
    if (file.ownerId !== user.id && !(await s.lobbies.canReadAsset(user.id, assetId))) throw forbidden("Файл пока недоступен в этом лобби");
    reply.header("content-type", file.mime);
    reply.header("cache-control", "private, max-age=86400, immutable");
    reply.header("x-content-type-options", "nosniff");
    reply.header("accept-ranges", "bytes");
    if (req.method === "GET" && req.headers.range) {
      const range = parseFileRange(req.headers.range, file.bytes);
      if (!range) return reply.code(416).header("content-range", `bytes */${file.bytes}`).send();
      reply.code(206).header("content-range", `bytes ${range.start}-${range.end}/${file.bytes}`).header("content-length", range.end - range.start + 1);
      return reply.send(createReadStream(file.path, range));
    }
    reply.header("content-length", file.bytes);
    if (req.method === "HEAD") return reply.send();
    return reply.send(createReadStream(file.path, { start: 0, end: file.bytes - 1 }));
  } });

  // ---------- lobbies ----------
  app.get("/api/lobbies", async (req) => {
    requireAccount(req);
    return { lobbies: await s.lobbies.list() };
  });
  app.post("/api/lobbies", async (req, reply) => {
    const user = requireAccount(req);
    const body = parse(
      z.object({ name: z.string().max(60).default(""), configId: z.string().max(80).optional(), config: z.unknown().optional() }),
      req.body,
    ) as CreateLobbyRequest;
    const lobby = await s.lobbies.create(user, body);
    reply.code(201);
    return { lobby };
  });
  app.get("/api/lobbies/:id/invitation", async (req) => ({ invitation: await s.lobbies.invitation(parse(idParam, req.params).id) }));
  app.get("/api/lobbies/:id", async (req) => withUser(req, async (user) => {
    const id = parse(idParam, req.params).id;
    await s.lobbies.visit(user, id);
    return { lobby: await s.lobbies.get(id) };
  }));
  app.post("/api/lobbies/:id/join", async (req) => withUser(req, async (user) => {
    const body = parse(z.object({ role: z.enum(["player", "spectator"]) }), req.body);
    const id = parse(idParam, req.params).id;
    await s.lobbies.visit(user, id);
    return { lobby: await s.lobbies.join(user, id, body.role) };
  }));
  app.post("/api/lobbies/:id/presenter", async (req) => {
    const user = requireAccount(req);
    const body = parse(z.object({ userId: z.string().max(80).nullable() }), req.body);
    return { lobby: await s.lobbies.setPresenter(user, parse(idParam, req.params).id, body.userId) };
  });
  app.post("/api/lobbies/:id/leave", async (req) => withUser(req, async (user) => ({ lobby: await s.lobbies.leave(user, parse(idParam, req.params).id) })));
  app.post("/api/lobbies/:id/start", async (req) => ({ lobby: await s.lobbies.start(requireAccount(req), parse(idParam, req.params).id) }));
  app.post("/api/lobbies/:id/close", async (req) => ({ lobby: await s.lobbies.close(requireAccount(req), parse(idParam, req.params).id) }));

  // ---------- WebSocket ----------
  const clientMessage = z.discriminatedUnion("type", [
    z.object({ type: z.literal("subscribe"), lobbyId: z.string().max(80) }),
    z.object({ type: z.literal("unsubscribe"), lobbyId: z.string().max(80) }),
    z.object({ type: z.literal("action"), lobbyId: z.string().max(80), action: z.unknown() }),
    z.object({ type: z.literal("control"), lobbyId: z.string().max(80), action: z.unknown() }),
    z.object({ type: z.literal("ping") }),
  ]);

  app.get("/ws", { websocket: true }, (socket, req) => {
    const user = req.user;
    if (!user) {
      socket.close(4401, "unauthorized");
      return;
    }
    const send = (msg: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };
    const sub: Subscriber = { userId: user.id, send, closed: () => socket.readyState === socket.CLOSING || socket.readyState === socket.CLOSED };
    const token = req.cookies[SESSION_COOKIE]!;
    const stopWatching = s.auth.watchSession(token, () => socket.close(4401, "session_ended"));
    let expiryTimer: NodeJS.Timeout | undefined;
    const checkExpiry = async () => {
      const expires = await s.auth.sessionExpiresAt(token);
      if (socket.readyState !== socket.OPEN) return;
      if (expires === null || expires <= s.now()) { socket.close(4401, "session_ended"); return; }
      expiryTimer = setTimeout(() => void checkExpiry().catch(() => socket.close(1011)), Math.min(expires - s.now(), 2 ** 31 - 1));
      expiryTimer.unref();
    };
    void checkExpiry().catch(() => socket.close(1011));
    socket.on("message", (raw) => {
      void s.auth.withSession(token, async (current) => {
        if (!current || socket.readyState !== socket.OPEN) { socket.close(4401, "session_ended"); return; }
        let msg: ClientMessage;
        const parsed = clientMessage.safeParse(JSON.parse(raw.toString()));
        if (!parsed.success) throw badRequest("bad_message", "Неверное сообщение");
        msg = parsed.data as ClientMessage;
        if (msg.type === "ping") send({ type: "pong", serverTime: s.now() });
        else if (msg.type === "subscribe") {
          await s.lobbies.visit(current, msg.lobbyId);
          await s.lobbies.subscribe(sub, msg.lobbyId);
        } else if (msg.type === "unsubscribe") s.lobbies.unsubscribe(sub, msg.lobbyId);
        else if (msg.type === "action" || msg.type === "control") {
          const res = msg.type === "control" ? await s.lobbies.control(current, msg.lobbyId, msg.action) : await s.lobbies.action(current, msg.lobbyId, msg.action);
          if (!res.ok) send({ type: "error", code: res.error.code, message: res.error.message });
        }
      }).catch((e) => {
        const err = e instanceof HttpError ? e : null;
        if (!err && !(e instanceof SyntaxError)) req.log.error({ err: e }, "ws handler failed");
        send({ type: "error", code: err?.code ?? (e instanceof SyntaxError ? "bad_message" : "internal"),
          message: err?.message ?? (e instanceof SyntaxError ? "Неверное сообщение" : "Ошибка сервера") });
      });
    });
    socket.on("close", () => { clearTimeout(expiryTimer); stopWatching(); s.lobbies.unsubscribe(sub); });
  });
}
