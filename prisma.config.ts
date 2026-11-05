import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

// The CLI no longer loads .env or reads the url from the schema.
// scripts/prisma.mjs loads .env and defaults DATABASE_URL before calling the CLI.
export default defineConfig({
  schema: "apps/server/prisma/schema.prisma",
  migrations: { path: "apps/server/prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? `file:${resolve("storage/asobiba.db")}` },
});
