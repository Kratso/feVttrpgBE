import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../plugins/db";
import { requireCampaignMember, requireDM } from "../utils/auth";

const characterSchema = z.object({
  name: z.string().min(2),
  stats: z.record(z.string(), z.number()),
  ownerId: z.string().optional(),
  kind: z.enum(["PLAYER", "NPC", "ENEMY"]).optional(),
  className: z.string().optional(),
  level: z.number().int().min(1).optional(),
  exp: z.number().int().min(0).optional(),
  weaponSkills: z
    .array(z.object({ weapon: z.string(), rank: z.string() }))
    .optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  stats: z.record(z.string(), z.number()).optional(),
});

export async function characterRoutes(fastify: FastifyInstance) {
  fastify.get("/campaigns/:id/characters", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const membership = await requireCampaignMember(request, reply, params.id);
    if (!membership) {
      return;
    }

    const characters = await prisma.character.findMany({
      where: { campaignId: params.id },
      include: { owner: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: "desc" },
    });

    reply.send({ characters });
  });

  fastify.post("/campaigns/:id/characters", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const dm = await requireDM(request, reply, params.id);
    if (!dm) {
      return;
    }

    const body = characterSchema.parse(request.body);
    const kind = body.kind ?? "PLAYER";
    const ownerId = kind === "PLAYER" ? body.ownerId ?? dm.userId : null;

    const character = await prisma.character.create({
      data: {
        name: body.name,
        stats: body.stats,
        ownerId,
        kind,
        className: body.className ?? null,
        level: body.level ?? 1,
        exp: body.exp ?? 0,
        weaponSkills: body.weaponSkills ?? undefined,
        campaignId: params.id,
      },
      include: { owner: { select: { id: true, displayName: true } } },
    });

    reply.send({ character });
  });

  fastify.get("/characters/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const character = await prisma.character.findUnique({
      where: { id: params.id },
      include: { owner: { select: { id: true, displayName: true } }, campaign: true },
    });

    if (!character) {
      reply.code(404).send({ error: "Character not found" });
      return;
    }

    const membership = await requireCampaignMember(request, reply, character.campaignId);
    if (!membership) {
      return;
    }

    reply.send({ character });
  });

  fastify.put("/characters/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.character.findUnique({
      where: { id: params.id },
    });

    if (!existing) {
      reply.code(404).send({ error: "Character not found" });
      return;
    }

    const dm = await requireDM(request, reply, existing.campaignId);
    if (!dm) {
      return;
    }

    const body = updateSchema.parse(request.body);
    const character = await prisma.character.update({
      where: { id: params.id },
      data: {
        name: body.name ?? existing.name,
        stats: body.stats ?? (existing.stats as Record<string, number>),
      },
    });

    reply.send({ character });
  });
}
