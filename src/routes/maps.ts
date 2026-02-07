import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../plugins/db";
import { requireCampaignMember, requireDM } from "../utils/auth";

const tileGridSchema = z.array(z.array(z.string().nullable()));

const mapSchema = z
  .object({
    name: z.string().min(2),
    imageUrl: z.string().url().optional(),
    tileSetId: z.string().optional(),
    tileCountX: z.number().int().min(5).max(200).optional(),
    tileCountY: z.number().int().min(5).max(200).optional(),
    tileGrid: tileGridSchema.optional(),
    gridSizeX: z.number().int().min(10).max(200).optional(),
    gridSizeY: z.number().int().min(10).max(200).optional(),
    gridOffsetX: z.number().int().optional(),
    gridOffsetY: z.number().int().optional(),
  })
  .refine((value) => value.imageUrl || value.tileSetId, {
    message: "Map requires imageUrl or tileSetId",
    path: ["imageUrl"],
  });

const mapUpdateSchema = z.object({
  imageUrl: z.string().url().optional(),
  tileSetId: z.string().optional(),
  tileCountX: z.number().int().min(5).max(200).optional(),
  tileCountY: z.number().int().min(5).max(200).optional(),
  tileGrid: tileGridSchema.optional(),
  gridSizeX: z.number().int().min(10).max(200).optional(),
  gridSizeY: z.number().int().min(10).max(200).optional(),
  gridOffsetX: z.number().int().optional(),
  gridOffsetY: z.number().int().optional(),
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
    const tileSet = body.tileSetId
      ? await prisma.tileSet.findUnique({ where: { id: body.tileSetId } })
      : null;

    if (body.tileSetId && !tileSet) {
      reply.code(404).send({ error: "Tileset not found" });
      return;
    }

    const gridSizeX = body.gridSizeX ?? tileSet?.tileSizeX ?? 50;
    const gridSizeY = body.gridSizeY ?? tileSet?.tileSizeY ?? 50;
    const tileCountX = body.tileCountX ?? 10;
    const tileCountY = body.tileCountY ?? 10;
    const tileGrid = body.tileGrid ?? buildEmptyGrid(tileCountY, tileCountX);

    try {
      assertGridSize(tileGrid, tileCountY, tileCountX);
    } catch (error) {
      reply.code(400).send({ error: (error as Error).message });
      return;
    }

    const map = await prisma.map.create({
      data: {
        name: body.name,
        imageUrl: body.imageUrl ?? null,
        gridSizeX,
        gridSizeY,
        gridOffsetX: body.gridOffsetX ?? 0,
        gridOffsetY: body.gridOffsetY ?? 0,
        tileCountX,
        tileCountY,
        tileGrid,
        tileSetId: body.tileSetId ?? null,
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

  fastify.put("/maps/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const map = await prisma.map.findUnique({
      where: { id: params.id },
      include: { campaign: true },
    });

    if (!map) {
      reply.code(404).send({ error: "Map not found" });
      return;
    }

    const dm = await requireDM(request, reply, map.campaignId);
    if (!dm) {
      return;
    }

    const body = mapUpdateSchema.parse(request.body);
    const nextTileSetId = body.tileSetId ?? map.tileSetId ?? null;
    const tileSet = nextTileSetId
      ? await prisma.tileSet.findUnique({ where: { id: nextTileSetId } })
      : null;

    if (nextTileSetId && !tileSet) {
      reply.code(404).send({ error: "Tileset not found" });
      return;
    }

    const gridSizeX = body.gridSizeX ?? tileSet?.tileSizeX ?? map.gridSizeX;
    const gridSizeY = body.gridSizeY ?? tileSet?.tileSizeY ?? map.gridSizeY;
    const tileCountX = body.tileCountX ?? map.tileCountX;
    const tileCountY = body.tileCountY ?? map.tileCountY;
    const tileGrid = body.tileGrid ?? (map.tileGrid as Array<Array<string | null>> | null);

    if (tileGrid) {
      try {
        assertGridSize(tileGrid, tileCountY, tileCountX);
      } catch (error) {
        reply.code(400).send({ error: (error as Error).message });
        return;
      }
    }

    const updated = await prisma.map.update({
      where: { id: params.id },
      data: {
        imageUrl: body.imageUrl ?? map.imageUrl,
        gridSizeX,
        gridSizeY,
        gridOffsetX: body.gridOffsetX ?? map.gridOffsetX,
        gridOffsetY: body.gridOffsetY ?? map.gridOffsetY,
        tileCountX,
        tileCountY,
        tileGrid: tileGrid ?? map.tileGrid,
        tileSetId: nextTileSetId,
      },
    });

    reply.send({ map: updated });
  });
}
