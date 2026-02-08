import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../plugins/db";
import { requireDM } from "../utils/auth";

export async function auditRoutes(fastify: FastifyInstance) {
  fastify.get("/maps/:id/audit", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const map = await prisma.map.findUnique({ where: { id: params.id } });
    if (!map) {
      reply.code(404).send({ error: "Map not found" });
      return;
    }

    const dm = await requireDM(request, reply, map.campaignId);
    if (!dm) {
      return;
    }

    const logs = await prisma.auditLog.findMany({
      where: { entityType: "MAP", entityId: params.id },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: "desc" },
    });

    reply.send({ logs });
  });

  fastify.get("/characters/:id/audit", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const character = await prisma.character.findUnique({ where: { id: params.id } });
    if (!character) {
      reply.code(404).send({ error: "Character not found" });
      return;
    }

    const dm = await requireDM(request, reply, character.campaignId);
    if (!dm) {
      return;
    }

    const logs = await prisma.auditLog.findMany({
      where: { entityType: "CHARACTER", entityId: params.id },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: "desc" },
    });

    reply.send({ logs });
  });
}
