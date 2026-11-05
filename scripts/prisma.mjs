#!/usr/bin/env node
// Runs the Prisma CLI against apps/server/prisma/schema.prisma.
// DATABASE_URL defaults to an absolute path to storage/asobiba.db, so relative
// paths never depend on where the schema file lives.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env");
if (!process.env.DATABASE_URL && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${resolve(root, "storage/asobiba.db")}`;
}
const dbPath = process.env.DATABASE_URL.replace(/^file:/, "");
if (dbPath.startsWith("/")) mkdirSync(dirname(dbPath), { recursive: true });

const bin = resolve(root, "node_modules/.bin/prisma");
const args = [...process.argv.slice(2), "--schema", resolve(root, "apps/server/prisma/schema.prisma")];
const result = spawnSync(bin, args, { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
