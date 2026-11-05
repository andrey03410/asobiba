// Creates a registration invite and prints the link: npm run invite [-- --admin]
// The very first invite on an empty database is always an admin invite.
import { AuthService } from "../apps/server/src/auth/service";
import { createPrisma } from "../apps/server/src/db";
import { loadEnv } from "../apps/server/src/env";

const env = loadEnv();
const db = createPrisma(env.databaseUrl);
const users = await db.user.count();
const role = process.argv.includes("--admin") || users === 0 ? "admin" : "user";
const { code, invite } = await new AuthService(db).createInvite(null, role);
console.log(`Приглашение (${role === "admin" ? "админ" : "игрок"}, до ${invite.expiresAt.slice(0, 10)}):`);
console.log(`${env.publicUrl}/register?invite=${code}`);
if (users === 0) console.log("Пользователей ещё нет, поэтому приглашение админское.");
await db.$disconnect();
