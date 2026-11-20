import { readFileSync } from "node:fs";
import { AuthService } from "../apps/server/src/auth/service";
import { createPrisma } from "../apps/server/src/db";
import { loadEnv } from "../apps/server/src/env";

const login = process.argv[2];
const role = process.argv[3];
if (!login || (role !== "user" && role !== "admin")) throw new Error("Expected login and user or admin role");
const password = readFileSync(0, "utf8").replace(/\r?\n$/, "");
const db = createPrisma(loadEnv().databaseUrl);
try {
  const thatAccount = await db.user.findUnique({ where: { login } });
  if (thatAccount && thatAccount.role !== role) throw new Error("Account already exists with a different role");
  if (!thatAccount) {
    await new AuthService(db).createUser({ login, password, role, provisioned: true });
  }
  console.log(`Account ready: ${login}`);
} finally {
  await db.$disconnect();
}
