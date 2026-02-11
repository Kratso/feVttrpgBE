import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../plugins/db";
import { requireCampaignMember, requireDM } from "../utils/auth";
import type { Server as IOServer } from "socket.io";
import { writeAuditLog } from "../utils/audit";

const tileGridSchema = z.array(z.array(z.string().nullable()));

const mapSchema = z
  .object({
    name: z.string().min(2),
    imageUrl: z.string().url().optional(),
    tileCountX: z.number().int().min(5).max(200).optional(),
    tileCountY: z.number().int().min(5).max(200).optional(),
    tileGrid: tileGridSchema.optional(),
    gridSizeX: z.number().int().min(10).max(200).optional(),
    gridSizeY: z.number().int().min(10).max(200).optional(),
    gridOffsetX: z.number().int().optional(),
    gridOffsetY: z.number().int().optional(),
  })
  .refine((value) => value.imageUrl || value.tileGrid, {
    message: "Map requires imageUrl or tileGrid",
    path: ["imageUrl"],
  });

const mapUpdateSchema = z.object({
  imageUrl: z.string().url().optional(),
  tileCountX: z.number().int().min(5).max(200).optional(),
  tileCountY: z.number().int().min(5).max(200).optional(),
  tileGrid: tileGridSchema.optional(),
  gridSizeX: z.number().int().min(10).max(200).optional(),
  gridSizeY: z.number().int().min(10).max(200).optional(),
  gridOffsetX: z.number().int().optional(),
  gridOffsetY: z.number().int().optional(),
});

const rollCreateSchema = z.object({
  type: z.enum(["REGULAR", "COMBAT"]),
});

const rollDie = (sides: number) => Math.floor(Math.random() * sides) + 1;

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
    const gridSizeX = body.gridSizeX ?? 50;
    const gridSizeY = body.gridSizeY ?? 50;
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
        campaignId: params.id,
      },
    });

    await writeAuditLog({
      entityType: "MAP",
      entityId: map.id,
      action: "MAP_CREATE",
      before: null,
      after: map,
      campaignId: map.campaignId,
      userId: dm.userId,
    });

    reply.send({ map });
  });

  fastify.get("/maps/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const map = await prisma.map.findUnique({
      where: { id: params.id },
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

  fastify.get("/maps/:id/rolls", async (request, reply) => {
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

    const rolls = await prisma.mapRollLog.findMany({
      where: { mapId: params.id },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, displayName: true } } },
    });

    reply.send({ rolls });
  });

  fastify.post("/maps/:id/rolls", async (request, reply) => {
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

    const body = rollCreateSchema.parse(request.body);
    const rollA = rollDie(100);
    const rollB = body.type === "COMBAT" ? rollDie(100) : null;
    const result = body.type === "COMBAT" ? Math.round((rollA + (rollB ?? 0)) / 2) : rollA;

    const roll = await prisma.mapRollLog.create({
      data: {
        mapId: params.id,
        userId: membership.userId,
        type: body.type,
        result,
      },
      include: { user: { select: { id: true, displayName: true } } },
    });

    const io = (fastify as FastifyInstance & { io?: IOServer }).io;
    io?.to(`map:${params.id}`).emit("roll:created", { roll });

    reply.send({ roll });
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
    const gridSizeX = body.gridSizeX ?? map.gridSizeX;
    const gridSizeY = body.gridSizeY ?? map.gridSizeY;
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
      },
    });

    await writeAuditLog({
      entityType: "MAP",
      entityId: updated.id,
      action: "MAP_UPDATE",
      before: map,
      after: updated,
      campaignId: updated.campaignId,
      userId: dm.userId,
    });

    reply.send({ map: updated });
  });
}
