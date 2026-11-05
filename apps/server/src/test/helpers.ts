import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { UserDto } from "@asobiba/api";
import type { FastifyInstance } from "fastify";
import { buildApp, type Services } from "../app";
import { createPrisma, type Db } from "../db";
import { loadEnv } from "../env";
import { randomString } from "../ids";

let sharedDb: Db | null = null;

export function testDb(): Db {
  sharedDb ??= createPrisma(process.env.DATABASE_URL as string);
  return sharedDb;
}

export async function resetDb(db: Db): Promise<void> {
  await db.match.deleteMany();
  await db.lobbyMember.deleteMany();
  await db.lobby.deleteMany();
  await db.gameConfig.deleteMany();
  await db.uploadTicket.deleteMany();
  await db.asset.deleteMany();
  await db.apiToken.deleteMany();
  await db.session.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany();
}

export interface TestApp {
  app: FastifyInstance;
  services: Services;
  db: Db;
  /** Base URL once `listen()` was called. */
  url: string;
  listen(): Promise<string>;
  close(): Promise<void>;
}

export async function createTestApp(options: { now?: () => number } = {}): Promise<TestApp> {
  const db = testDb();
  const storageDir = resolve(process.env.ASOBIBA_STORAGE_DIR as string, randomString(8));
  mkdirSync(storageDir, { recursive: true });
  const env = { ...loadEnv(), storageDir, publicUrl: "http://asobiba.test", production: false };
  const { app, services } = await buildApp({ env, db, now: options.now, logger: false });
  const t: TestApp = {
    app,
    services,
    db,
    url: "",
    async listen() {
      await app.listen({ port: 0, host: "127.0.0.1" });
      const addr = app.server.address();
      t.url = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
      return t.url;
    },
    async close() {
      await app.close();
    },
  };
  return t;
}

export interface TestUser {
  user: UserDto;
  cookie: string;
  password: string;
}

/** Creates a user through an invite and logs in; returns the session cookie header. */
export async function signUp(t: TestApp, login: string, role: "user" | "admin" = "user"): Promise<TestUser> {
  const { code } = await t.services.auth.createInvite(null, role);
  const password = "password-123";
  const res = await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { login, password, invite: code } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return { user: res.json().user, cookie: (raw ?? "").split(";")[0] as string, password };
}

export const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export const SIMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#ff7675"/></svg>';
