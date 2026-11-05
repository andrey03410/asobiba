// Recreates verification accounts verify-a (admin) and verify-b with fresh passwords
// and an MCP token for verify-a. Secrets go to storage/verify/accounts.json only.
// Usage: npx tsx --env-file-if-exists=.env scripts/seed-verify.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AuthService } from "../apps/server/src/auth/service";
import { createPrisma } from "../apps/server/src/db";
import { loadEnv, REPO_ROOT } from "../apps/server/src/env";
import { randomString } from "../apps/server/src/ids";

const env = loadEnv();
const db = createPrisma(env.databaseUrl);
const auth = new AuthService(db);
const accounts: Record<string, { login: string; password: string }> = {};
for (const [login, role] of [["verify-a", "admin"], ["verify-b", "user"]] as const) {
  await db.user.deleteMany({ where: { login } });
  const password = `v-${randomString(16)}`;
  await auth.createUser({ login, password, role });
  accounts[login] = { login, password };
}
const a = await db.user.findUniqueOrThrow({ where: { login: "verify-a" } });
const { secret } = await auth.createToken(a.id, "verify");
const file = resolve(REPO_ROOT, "storage/verify/accounts.json");
mkdirSync(resolve(file, ".."), { recursive: true });
writeFileSync(file, JSON.stringify({ accounts, mcpToken: secret, publicUrl: env.publicUrl }, null, 2));
console.log(`accounts: verify-a (admin), verify-b → ${file}`);
await db.$disconnect();
