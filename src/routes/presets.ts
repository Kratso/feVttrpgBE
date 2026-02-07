import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../plugins/db";
import { requireCampaignMember, requireDM } from "../utils/auth";

const tileGridSchema = z.array(z.array(z.string().nullable()));

const presetSchema = z.object({
  name: z.string().min(2),
  tileCountX: z.number().int().min(5).max(200),
  tileCountY: z.number().int().min(5).max(200),
  tileGrid: tileGridSchema,
});

const buildEmptyGrid = (rows: number, cols: number) =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));

const assertGridSize = (grid: Array<Array<string | null>>, rows: number, cols: number) => {
  if (grid.length !== rows) {
    throw new Error("Tile grid row count does not match tileCountY");
  }
  if (grid.some((row) => row.length !== cols)) {
    throw new Error("Tile grid column count does not match tileCountX");
  }
};

export async function presetRoutes(fastify: FastifyInstance) {
  fastify.get("/campaigns/:id/presets", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const membership = await requireCampaignMember(request, reply, params.id);
    if (!membership) {
      return;
    }

    const presets = await prisma.tilePreset.findMany({
      where: { campaignId: params.id },
      orderBy: { createdAt: "desc" },
    });

    reply.send({ presets });
  });

  fastify.post("/campaigns/:id/presets", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const dm = await requireDM(request, reply, params.id);
    if (!dm) {
      return;
    }

    const body = presetSchema.parse(request.body);
    try {
      assertGridSize(body.tileGrid, body.tileCountY, body.tileCountX);
    } catch (error) {
      reply.code(400).send({ error: (error as Error).message });
      return;
    }

    const preset = await prisma.tilePreset.create({
      data: {
        name: body.name,
        tileCountX: body.tileCountX,
        tileCountY: body.tileCountY,
        tileGrid: body.tileGrid ?? buildEmptyGrid(body.tileCountY, body.tileCountX),
        campaignId: params.id,
      },
    });

    reply.send({ preset });
  });

  fastify.get("/presets/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const preset = await prisma.tilePreset.findUnique({
      where: { id: params.id },
      include: { campaign: true },
    });

    if (!preset) {
      reply.code(404).send({ error: "Preset not found" });
      return;
    }

    const membership = await requireCampaignMember(request, reply, preset.campaignId);
    if (!membership) {
      return;
    }

    reply.send({ preset });
  });

  fastify.put("/presets/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.tilePreset.findUnique({
      where: { id: params.id },
      include: { campaign: true },
    });

    if (!existing) {
      reply.code(404).send({ error: "Preset not found" });
      return;
    }

    const dm = await requireDM(request, reply, existing.campaignId);
    if (!dm) {
      return;
    }

    const body = presetSchema.partial({ name: true }).parse(request.body);
    const tileCountX = body.tileCountX ?? existing.tileCountX;
    const tileCountY = body.tileCountY ?? existing.tileCountY;
    const tileGrid = (body.tileGrid ?? existing.tileGrid) as Array<Array<string | null>>;

    try {
      assertGridSize(tileGrid, tileCountY, tileCountX);
    } catch (error) {
      reply.code(400).send({ error: (error as Error).message });
      return;
    }

    const preset = await prisma.tilePreset.update({
      where: { id: params.id },
      data: {
        name: body.name ?? existing.name,
        tileCountX,
        tileCountY,
        tileGrid,
      },
    });

    reply.send({ preset });
  });

  fastify.delete("/presets/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.tilePreset.findUnique({
      where: { id: params.id },
      include: { campaign: true },
    });

    if (!existing) {
      reply.code(404).send({ error: "Preset not found" });
      return;
    }

    const dm = await requireDM(request, reply, existing.campaignId);
    if (!dm) {
      return;
    }

    await prisma.tilePreset.delete({ where: { id: params.id } });
    reply.send({ ok: true });
  });
}
