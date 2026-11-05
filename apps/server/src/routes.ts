import { createReadStream } from "node:fs";
import type { ClientMessage, CreateLobbyRequest, ServerMessage, UserDto } from "@asobiba/api";
import { describeGame, listGames } from "@asobiba/sdk";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Services } from "./app";
import { SESSION_TTL_MS } from "./auth/service";
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

function requireAdmin(req: FastifyRequest): UserDto {
  const user = requireUser(req);
  if (user.role !== "admin") throw forbidden("Только для админа");
  return user;
}

const idParam = z.object({ id: z.string().min(1).max(80) });

export function registerRoutes(app: FastifyInstance, s: Services): void {
  const setSession = async (reply: FastifyReply, userId: string) => {
    const { token } = await s.auth.createSession(userId);
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: s.env.cookieSecure,
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  };

  // ---------- auth ----------
  app.post("/api/auth/register", async (req, reply) => {
    const body = parse(z.object({ login: z.string(), password: z.string(), invite: z.string() }), req.body);
    const user = await s.auth.register(body);
    await setSession(reply, user.id);
    reply.code(201);
    return { user };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = parse(z.object({ login: z.string(), password: z.string() }), req.body);
    const user = await s.auth.verifyPassword(body.login, body.password);
    await setSession(reply, user.id);
    return { user };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    await s.auth.deleteSession(req.cookies[SESSION_COOKIE]);
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
  app.get("/api/tokens", async (req) => ({ tokens: await s.auth.listTokens(requireUser(req).id), mcpUrl }));
  app.post("/api/tokens", async (req, reply) => {
    const user = requireUser(req);
    const body = parse(z.object({ name: z.string().max(60) }), req.body);
    const { token, secret } = await s.auth.createToken(user.id, body.name);
    reply.code(201);
    return { token, secret, mcpUrl };
  });
  app.delete("/api/tokens/:id", async (req, reply) => {
    await s.auth.revokeToken(requireUser(req).id, parse(idParam, req.params).id);
    reply.code(204);
  });

  // ---------- games ----------
  app.get("/api/games", async (req) => {
    requireUser(req);
    return { games: listGames(s.catalog) };
  });
  app.get("/api/games/:id", async (req) => {
    requireUser(req);
    const game = s.catalog.get(parse(idParam, req.params).id);
    if (!game) throw notFound("Игра не найдена");
    return { game: describeGame(game) };
  });

  // ---------- configs ----------
  app.post("/api/configs/validate", async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ config: z.unknown() }), req.body);
    return s.configs.validate(user.id, body.config);
  });
  app.get("/api/configs", async (req) => ({ configs: await s.configs.list(requireUser(req).id) }));
  app.post("/api/configs", async (req, reply) => {
    const user = requireUser(req);
    const body = parse(z.object({ config: z.unknown() }), req.body);
    const config = await s.configs.save(user.id, body.config);
    reply.code(201);
    return { config };
  });
  app.put("/api/configs/:id", async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ config: z.unknown() }), req.body);
    return { config: await s.configs.save(user.id, body.config, parse(idParam, req.params).id) };
  });
  app.delete("/api/configs/:id", async (req, reply) => {
    await s.configs.remove(requireUser(req).id, parse(idParam, req.params).id);
    reply.code(204);
  });

  // ---------- assets ----------
  app.get("/api/assets", async (req) => ({ assets: await s.assets.list(requireUser(req).id) }));
  app.post("/api/assets", async (req, reply) => {
    const user = requireUser(req);
    const query = parse(z.object({ name: z.string().max(200).optional() }), req.query);
    if (!Buffer.isBuffer(req.body)) throw badRequest("no_file", "Пришлите картинку телом запроса (Content-Type image/*)");
    const asset = await s.assets.save(user.id, { name: query.name, body: req.body, source: "upload" });
    reply.code(201);
    return { asset };
  });
  app.delete("/api/assets/:id", async (req, reply) => {
    await s.assets.remove(requireUser(req).id, parse(idParam, req.params).id);
    reply.code(204);
  });
  app.put("/api/uploads/:ticket", async (req, reply) => {
    const { ticket } = parse(z.object({ ticket: z.string().startsWith("upl_").max(80) }), req.params);
    if (!Buffer.isBuffer(req.body)) throw badRequest("no_file", "Пришлите файл телом PUT-запроса");
    const asset = await s.assets.finishUpload(ticket, req.body);
    reply.code(201);
    return { asset };
  });
  app.get("/files/assets/:id", async (req, reply) => {
    requireUser(req);
    const file = await s.assets.file(parse(idParam, req.params).id);
    if (!file) throw notFound("Картинка не найдена");
    reply.header("content-type", file.mime);
    reply.header("cache-control", "private, max-age=86400, immutable");
    reply.header("x-content-type-options", "nosniff");
    return reply.send(createReadStream(file.path));
  });

  // ---------- lobbies ----------
  app.get("/api/lobbies", async (req) => {
    requireUser(req);
    return { lobbies: await s.lobbies.list() };
  });
  app.post("/api/lobbies", async (req, reply) => {
    const user = requireUser(req);
    const body = parse(
      z.object({ name: z.string().max(60).default(""), configId: z.string().max(80).optional(), config: z.unknown().optional() }),
      req.body,
    ) as CreateLobbyRequest;
    const lobby = await s.lobbies.create(user, body);
    reply.code(201);
    return { lobby };
  });
  app.get("/api/lobbies/:id", async (req) => {
    requireUser(req);
    return { lobby: await s.lobbies.get(parse(idParam, req.params).id) };
  });
  app.post("/api/lobbies/:id/join", async (req) => {
    const body = parse(z.object({ role: z.enum(["player", "spectator"]) }), req.body);
    return { lobby: await s.lobbies.join(requireUser(req), parse(idParam, req.params).id, body.role) };
  });
  app.post("/api/lobbies/:id/leave", async (req) => ({ lobby: await s.lobbies.leave(requireUser(req), parse(idParam, req.params).id) }));
  app.post("/api/lobbies/:id/start", async (req) => ({ lobby: await s.lobbies.start(requireUser(req), parse(idParam, req.params).id) }));
  app.post("/api/lobbies/:id/close", async (req) => ({ lobby: await s.lobbies.close(requireUser(req), parse(idParam, req.params).id) }));

  // ---------- WebSocket ----------
  const clientMessage = z.discriminatedUnion("type", [
    z.object({ type: z.literal("subscribe"), lobbyId: z.string().max(80) }),
    z.object({ type: z.literal("unsubscribe"), lobbyId: z.string().max(80) }),
    z.object({ type: z.literal("action"), lobbyId: z.string().max(80), action: z.unknown() }),
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
    const sub: Subscriber = { userId: user.id, send };
    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        const parsed = clientMessage.safeParse(JSON.parse(raw.toString()));
        if (!parsed.success) throw new Error("bad message");
        msg = parsed.data as ClientMessage;
      } catch {
        send({ type: "error", code: "bad_message", message: "Неверное сообщение" });
        return;
      }
      const fail = (e: unknown) => {
        const err = e instanceof HttpError ? e : null;
        if (!err) req.log.error({ err: e }, "ws handler failed");
        send({ type: "error", code: err?.code ?? "internal", message: err?.message ?? "Ошибка сервера" });
      };
      if (msg.type === "ping") send({ type: "pong", serverTime: s.now() });
      else if (msg.type === "subscribe") s.lobbies.subscribe(sub, msg.lobbyId).catch(fail);
      else if (msg.type === "unsubscribe") s.lobbies.unsubscribe(sub, msg.lobbyId);
      else if (msg.type === "action") {
        s.lobbies
          .action(user, msg.lobbyId, msg.action)
          .then((res) => {
            if (!res.ok) send({ type: "error", code: res.error.code, message: res.error.message });
          })
          .catch(fail);
      }
    });
    socket.on("close", () => s.lobbies.unsubscribe(sub));
  });
}
