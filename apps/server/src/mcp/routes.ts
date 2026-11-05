import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import type { Services } from "../app";
import { createMcpServer } from "./server";

/** Streamable HTTP without sessions: a fresh MCP server per POST, authorized by a personal token. */
export function registerMcpRoutes(app: FastifyInstance, s: Services): void {
  app.post("/mcp", async (req, reply) => {
    const header = req.headers.authorization ?? "";
    const secret = header.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    const user = await s.auth.userByToken(secret);
    if (!user) {
      reply.code(401).header("www-authenticate", 'Bearer realm="asobiba"');
      return {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Нужен личный токен: Authorization: Bearer asb_… (создаётся в кабинете на сайте)" },
        id: null,
      };
    }
    const server = createMcpServer(user, s);
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
