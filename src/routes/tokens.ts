import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../plugins/db";
import { requireCampaignMember, requireDM } from "../utils/auth";

const tokenSchema = z.object({
  label: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  color: z.string().optional(),
  characterId: z.string().min(1),
});

const updateSchema = z.object({
  x: z.number().int().min(0).optional(),
  y: z.number().int().min(0).optional(),
  label: z.string().optional(),
  color: z.string().optional(),
  characterId: z.string().min(1).optional(),
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
      include: {
        character: { include: { owner: { select: { id: true, displayName: true } } } },
      },
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
    const character = await prisma.character.findUnique({
      where: { id: body.characterId },
    });

    if (!character || character.campaignId !== map.campaignId) {
      reply.code(400).send({ error: "Character not found in campaign" });
      return;
    }

    const existingToken = await prisma.token.findUnique({
      where: { characterId: body.characterId },
    });

    if (existingToken) {
      reply.code(400).send({ error: "Character already has a token" });
      return;
    }

    const token = await prisma.token.create({
      data: {
        mapId: params.id,
        label: body.label,
        x: body.x,
        y: body.y,
        color: body.color ?? "#f43f5e",
        characterId: body.characterId,
      },
      include: {
        character: { include: { owner: { select: { id: true, displayName: true } } } },
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
    if (body.characterId && body.characterId !== existing.characterId) {
      const character = await prisma.character.findUnique({
        where: { id: body.characterId },
      });

      if (!character || character.campaignId !== existing.map.campaignId) {
        reply.code(400).send({ error: "Character not found in campaign" });
        return;
      }

      const duplicate = await prisma.token.findUnique({
        where: { characterId: body.characterId },
      });

      if (duplicate) {
        reply.code(400).send({ error: "Character already has a token" });
        return;
      }
    }
    const token = await prisma.token.update({
      where: { id: params.id },
      data: {
        x: body.x ?? existing.x,
        y: body.y ?? existing.y,
        label: body.label ?? existing.label,
        color: body.color ?? existing.color,
        characterId: body.characterId ?? existing.characterId,
      },
      include: {
        character: { include: { owner: { select: { id: true, displayName: true } } } },
      },
    });

    reply.send({ token });
  });
}
