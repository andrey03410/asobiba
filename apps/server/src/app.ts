import { existsSync } from "node:fs";
import { join } from "node:path";
import type { UserDto } from "@asobiba/api";
import type { GameCatalog } from "@asobiba/sdk";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { MAX_IMAGE_BYTES } from "./assets/images";
import { AssetService } from "./assets/service";
import { AuthService } from "./auth/service";
import { ConfigService } from "./configs/service";
import type { Db } from "./db";
import type { Env } from "./env";
import { catalog as defaultCatalog } from "./games/catalog";
import { HttpError } from "./http-errors";
import { LobbyService } from "./lobbies/service";
import { registerMcpRoutes } from "./mcp/routes";
import { registerRoutes, SESSION_COOKIE } from "./routes";

declare module "fastify" {
  interface FastifyRequest {
    user: UserDto | null;
  }
}

export interface Services {
  env: Env;
  db: Db;
  catalog: GameCatalog;
  now: () => number;
  auth: AuthService;
  assets: AssetService;
  configs: ConfigService;
  lobbies: LobbyService;
}

export interface AppOptions {
  env: Env;
  db: Db;
  catalog?: GameCatalog;
  now?: () => number;
  logger?: boolean | { level: string };
}

/** One-time secrets that travel in URLs must not end up in logs. */
export function redactUrl(url: string): string {
  return url
    .replace(/(\/api\/uploads\/)[^/?#]+/, "$1<ticket>")
    .replace(/(\/api\/invites\/check\/)[^/?#]+/, "$1<code>")
    .replace(/([?&]invite=)[^&#]+/, "$1<code>");
}

export async function buildApp(options: AppOptions): Promise<{ app: FastifyInstance; services: Services }> {
  const { env, db } = options;
  const catalog = options.catalog ?? defaultCatalog;
  const now = options.now ?? Date.now;
  const level = options.logger === false ? undefined : typeof options.logger === "object" ? options.logger.level : env.production ? "info" : "warn";
  const app = Fastify({
    logger: level ? { level, serializers: { req: (req) => ({ method: req.method, url: redactUrl(req.url), remoteAddress: req.ip }) } } : false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  const auth = new AuthService(db, now);
  const assets = new AssetService(db, env);
  const configs = new ConfigService(db, catalog, assets);
  const lobbies = new LobbyService({ db, catalog, configs, env, now, log: app.log });
  const services: Services = { env, db, catalog, now, auth, assets, configs, lobbies };

  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  // Raw image bodies for uploads (any type, including none — curl --upload-file sends none)
  const rawBody = { parseAs: "buffer" as const, bodyLimit: MAX_IMAGE_BYTES + 64 * 1024 };
  app.addContentTypeParser(/^image\/.+/, rawBody, (_req, body, done) => done(null, body));
  app.addContentTypeParser("application/octet-stream", rawBody, (_req, body, done) => done(null, body));
  app.addContentTypeParser("*", rawBody, (_req, body, done) => done(null, body));

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req) => {
    req.user = await auth.userBySession(req.cookies[SESSION_COOKIE]);
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message }, ...(err.issues ? { issues: err.issues } : {}) });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: err.code ?? "bad_request", message: err.message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "internal", message: "Ошибка сервера" } });
  });

  registerRoutes(app, services);
  registerMcpRoutes(app, services);

  if (env.production && existsSync(join(env.webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: env.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      const apiLike = /^\/(api|files|ws|mcp)(\/|$)/.test(req.url);
      if (req.method === "GET" && !apiLike) return reply.sendFile("index.html");
      return reply.code(404).send({ error: { code: "not_found", message: "Не найдено" } });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: "not_found", message: "Не найдено" } }));
  }

  app.addHook("onClose", async () => lobbies.shutdown());
  return { app, services };
}
