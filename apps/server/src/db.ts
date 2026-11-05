import { PrismaClient } from "./generated/prisma/client";
import { sqliteAdapter } from "./sqlite";

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: sqliteAdapter(databaseUrl) });
}

export type Db = PrismaClient;
