import { resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

export interface Env {
  port: number;
  host: string;
  /** Public origin of the site, without a trailing slash. Links to lobbies, invites and uploads use it. */
  publicUrl: string;
  databaseUrl: string;
  storageDir: string;
  cookieSecure: boolean;
  allowPrivateUrls: boolean;
  production: boolean;
  webDist: string;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const port = Number(source.PORT ?? 8787);
  return {
    port,
    host: source.HOST ?? "127.0.0.1",
    publicUrl: (source.PUBLIC_URL ?? `http://localhost:${source.NODE_ENV === "production" ? port : 5173}`).replace(/\/+$/, ""),
    databaseUrl: source.DATABASE_URL ?? `file:${resolve(REPO_ROOT, "storage/asobiba.db")}`,
    storageDir: source.ASOBIBA_STORAGE_DIR ?? resolve(REPO_ROOT, "storage"),
    cookieSecure: source.COOKIE_SECURE === "1",
    allowPrivateUrls: source.ASSET_URL_ALLOW_PRIVATE === "1",
    production: source.NODE_ENV === "production",
    webDist: resolve(REPO_ROOT, "apps/web/dist"),
  };
}
