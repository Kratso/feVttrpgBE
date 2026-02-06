import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../plugins/db";
import { requireCampaignMember, requireDM } from "../utils/auth";

const mapSchema = z.object({
  name: z.string().min(2),
  imageUrl: z.string().url(),
  gridSize: z.number().int().min(10).max(200).optional(),
  gridOffsetX: z.number().int().optional(),
  gridOffsetY: z.number().int().optional(),
});

export async function mapRoutes(fastify: FastifyInstance) {
  fastify.get("/campaigns/:id/maps", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const membership = await requireCampaignMember(request, reply, params.id);
    if (!membership) {
      return;
    }

    const maps = await prisma.map.findMany({
      where: { campaignId: params.id },
      orderBy: { createdAt: "desc" },
    });

    reply.send({ maps });
  });

  fastify.post("/campaigns/:id/maps", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const dm = await requireDM(request, reply, params.id);
    if (!dm) {
      return;
    }

    const body = mapSchema.parse(request.body);
    const map = await prisma.map.create({
      data: {
        name: body.name,
        imageUrl: body.imageUrl,
        gridSize: body.gridSize ?? 50,
        gridOffsetX: body.gridOffsetX ?? 0,
        gridOffsetY: body.gridOffsetY ?? 0,
        campaignId: params.id,
      },
    });

    reply.send({ map });
  });

  fastify.get("/maps/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const map = await prisma.map.findUnique({
      where: { id: params.id },
      include: { campaign: true },
    });

    if (!map) {
      reply.code(404).send({ error: "Map not found" });
      return;
    }

    const membership = await requireCampaignMember(request, reply, map.campaignId);
    if (!membership) {
      return;
    }

    reply.send({ map });
  });
}
