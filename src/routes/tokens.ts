import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../plugins/db";
import { requireCampaignMember, requireDM } from "../utils/auth";

const tokenSchema = z.object({
  label: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  color: z.string().optional(),
});

const updateSchema = z.object({
  x: z.number().int().min(0).optional(),
  y: z.number().int().min(0).optional(),
  label: z.string().optional(),
  color: z.string().optional(),
});

export async function tokenRoutes(fastify: FastifyInstance) {
  fastify.get("/maps/:id/tokens", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const map = await prisma.map.findUnique({ where: { id: params.id } });
    if (!map) {
      reply.code(404).send({ error: "Map not found" });
      return;
    }

    const membership = await requireCampaignMember(request, reply, map.campaignId);
    if (!membership) {
      return;
    }

    const tokens = await prisma.token.findMany({
      where: { mapId: params.id },
      orderBy: { createdAt: "asc" },
    });

    reply.send({ tokens });
  });

  fastify.post("/maps/:id/tokens", async (request, reply) => {
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

    const body = tokenSchema.parse(request.body);
    const token = await prisma.token.create({
      data: {
        mapId: params.id,
        label: body.label,
        x: body.x,
        y: body.y,
        color: body.color ?? "#f43f5e",
      },
    });

    reply.send({ token });
  });

  fastify.put("/tokens/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.token.findUnique({
      where: { id: params.id },
      include: { map: true },
    });

    if (!existing) {
      reply.code(404).send({ error: "Token not found" });
      return;
    }

    const dm = await requireDM(request, reply, existing.map.campaignId);
    if (!dm) {
      return;
    }

    const body = updateSchema.parse(request.body);
    const token = await prisma.token.update({
      where: { id: params.id },
      data: {
        x: body.x ?? existing.x,
        y: body.y ?? existing.y,
        label: body.label ?? existing.label,
        color: body.color ?? existing.color,
      },
    });

    reply.send({ token });
  });
}
