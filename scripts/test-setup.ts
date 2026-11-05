// Vitest global setup: recreates storage/test with a fresh database from migrations.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export const TEST_ROOT = resolve(import.meta.dirname, "../storage/test");

export default function setup() {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
  execFileSync("node", [resolve(import.meta.dirname, "prisma.mjs"), "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: `file:${resolve(TEST_ROOT, "test.db")}` },
    stdio: "pipe",
  });
}
