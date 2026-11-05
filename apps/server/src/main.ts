import { buildApp } from "./app";
import { createPrisma } from "./db";
import { loadEnv } from "./env";

const env = loadEnv();
const db = createPrisma(env.databaseUrl);
const { app, services } = await buildApp({ env, db, logger: { level: env.production ? "info" : "info" } });

const restored = await services.lobbies.restoreAll();
if (restored.restored || restored.aborted) app.log.info(restored, "matches after restart");

await app.listen({ port: env.port, host: env.host });
app.log.info(`Asobiba: http://${env.host}:${env.port} (public ${env.publicUrl}), MCP ${env.publicUrl}/mcp`);

const stop = async () => {
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
