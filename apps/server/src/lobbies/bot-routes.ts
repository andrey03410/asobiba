import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Services } from "../app";
import { badRequest } from "../http-errors";
import { requireAccount } from "../routes";

const reservation = z.strictObject({
  name: z.string().trim().min(1).max(24),
  difficulty: z.enum(["low", "medium", "high", "maximum"]).optional(),
});

export function registerBotRoutes(app: FastifyInstance, services: Services) {
  app.post<{ Params: { id: string } }>("/api/lobbies/:id/bots", async (req, reply) => {
    const host = requireAccount(req);
    const parsed = reservation.safeParse(req.body);
    if (!parsed.success) throw badRequest("invalid_bot", "Проверьте имя и уровень ИИ");
    reply.header("cache-control", "no-store");
    return services.lobbies.reserveBot(host, req.params.id, parsed.data);
  });

  app.delete<{ Params: { id: string; userId: string } }>("/api/lobbies/:id/bots/:userId", async (req) => ({
    lobby: await services.lobbies.removeBot(requireAccount(req), req.params.id, req.params.userId),
  }));
}
