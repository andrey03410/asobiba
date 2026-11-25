import { kanameEnabled } from "@kaname/service-client";
import { recordActivity } from "../kaname";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import type { Services } from "../app";
import { CONFIG_REQUEST_BODY_BYTES } from "../configs/service";
import { createPlayerServer } from "./player";
import { FailureLimiter } from "../auth/rate-limit";
import { createMcpServer } from "./server";

/** Stateless transport. Each POST selects its own server-side authority. */
export function registerMcpRoutes(app: FastifyInstance, s: Services): void {
  const joins = new FailureLimiter(30, 15 * 60_000, s.now);
  app.post("/mcp", { bodyLimit: CONFIG_REQUEST_BODY_BYTES }, async (req, reply) => {
    const header = req.headers.authorization;
    const secret = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    const identity = await s.auth.mcpIdentity(secret);
    if (header !== undefined && !identity) {
      reply.code(401).header("www-authenticate", 'Bearer realm="asobiba"');
      return {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Недействительный токен MCP" },
        id: null,
      };
    }
    const user = identity?.user;
    if (user && kanameEnabled() && (req.body as { method?: string })?.method === "tools/call") {
      const identity = await s.db.user.findUnique({ where: { id: user.id }, select: { kanameSubject: true } });
      if (identity?.kanameSubject) await recordActivity(s, identity.kanameSubject);
    }
    const server = identity?.scope === "organizer" ? createMcpServer(identity.user, s) : createPlayerServer(user, s, () => {
      joins.check([req.ip]);
      joins.fail([req.ip]);
    }, identity?.tokenId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  const notAllowed = async (_req: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) =>
    reply.code(405).send({ jsonrpc: "2.0", error: { code: -32000, message: "Сервер без сессий: используйте POST" }, id: null });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
