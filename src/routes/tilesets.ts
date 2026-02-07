import { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MultipartFile } from "@fastify/multipart";
import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import sharp from "sharp";
import { prisma } from "../plugins/db";
import { requireCampaignMember, requireDM } from "../utils/auth";

const tileSchema = z.object({
  index: z.number().int().min(0),
  imageUrl: z.string().url(),
});

const tileSetSchema = z.object({
  name: z.string().min(2),
  imageUrl: z.string().url(),
  tileSizeX: z.number().int().min(8).max(256),
  tileSizeY: z.number().int().min(8).max(256),
  columns: z.number().int().min(1).max(512),
  rows: z.number().int().min(1).max(512),
  tiles: z.array(tileSchema).optional(),
});

const tileSetUploadSchema = z.object({
  name: z.string().min(2),
  tileSizeX: z.coerce.number().int().min(8).max(256),
  tileSizeY: z.coerce.number().int().min(8).max(256),
  columns: z.coerce.number().int().min(1).max(512),
  rows: z.coerce.number().int().min(1).max(512),
});

const getPublicBaseUrl = () => process.env.PUBLIC_BASE_URL ?? "http://localhost:4000";

export async function tileSetRoutes(fastify: FastifyInstance) {
  fastify.get("/campaigns/:id/tilesets", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const membership = await requireCampaignMember(request, reply, params.id);
    if (!membership) {
      return;
    }

    const tileSets = await prisma.tileSet.findMany({
      where: { campaignId: params.id },
      orderBy: { createdAt: "desc" },
      include: { tiles: true },
    });

    reply.send({ tileSets });
  });

  fastify.post("/campaigns/:id/tilesets", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const dm = await requireDM(request, reply, params.id);
    if (!dm) {
      return;
    }

    const body = tileSetSchema.parse(request.body);
    const tileSet = await prisma.tileSet.create({
      data: {
        name: body.name,
        imageUrl: body.imageUrl,
        tileSizeX: body.tileSizeX,
        tileSizeY: body.tileSizeY,
        columns: body.columns,
        rows: body.rows,
        campaignId: params.id,
        tiles: body.tiles
          ? {
              create: body.tiles.map((tile) => ({
                index: tile.index,
                imageUrl: tile.imageUrl,
              })),
            }
          : undefined,
      },
      include: { tiles: true },
    });

    reply.send({ tileSet });
  });

  fastify.post("/campaigns/:id/tilesets/upload", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const dm = await requireDM(request, reply, params.id);
    if (!dm) {
      return;
    }

    if (!request.isMultipart()) {
      reply.code(400).send({ error: "Multipart form required" });
      return;
    }

    const fields: Record<string, string> = {};
    let filePart: MultipartFile | null = null;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        filePart = part;
        continue;
      }
      fields[part.fieldname] = part.value;
    }

    if (!filePart) {
      reply.code(400).send({ error: "Tileset image is required" });
      return;
    }

    const parsed = tileSetUploadSchema.safeParse(fields);
    if (!parsed.success) {
      reply.code(400).send({ error: "Invalid upload fields", details: parsed.error.errors });
      return;
    }

    const buffer = await filePart.toBuffer();
    const metadata = await sharp(buffer).metadata();
    const expectedWidth = parsed.data.columns * parsed.data.tileSizeX;
    const expectedHeight = parsed.data.rows * parsed.data.tileSizeY;

    if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
      reply.code(400).send({
        error: "Tileset image dimensions do not match columns/rows and tile size",
        details: {
          expectedWidth,
          expectedHeight,
          width: metadata.width,
          height: metadata.height,
        },
      });
      return;
    }

    const tileSetId = crypto.randomUUID();
    const uploadRoot = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
    const tileSetDir = path.join(uploadRoot, "tilesets", tileSetId);
    await fs.mkdir(tileSetDir, { recursive: true });

    const tilesetFile = path.join(tileSetDir, "tileset.png");
    await sharp(buffer).png().toFile(tilesetFile);

    const publicBaseUrl = getPublicBaseUrl();
    const tilesetUrl = `${publicBaseUrl}/uploads/tilesets/${tileSetId}/tileset.png`;

    const tiles: Array<{ index: number; imageUrl: string }> = [];
    for (let row = 0; row < parsed.data.rows; row += 1) {
      for (let col = 0; col < parsed.data.columns; col += 1) {
        const index = row * parsed.data.columns + col;
        const tileFile = path.join(tileSetDir, `tile-${index}.png`);
        await sharp(buffer)
          .extract({
            left: col * parsed.data.tileSizeX,
            top: row * parsed.data.tileSizeY,
            width: parsed.data.tileSizeX,
            height: parsed.data.tileSizeY,
          })
          .png()
          .toFile(tileFile);
        tiles.push({
          index,
          imageUrl: `${publicBaseUrl}/uploads/tilesets/${tileSetId}/tile-${index}.png`,
        });
      }
    }

    const tileSet = await prisma.tileSet.create({
      data: {
        id: tileSetId,
        name: parsed.data.name,
        imageUrl: tilesetUrl,
        tileSizeX: parsed.data.tileSizeX,
        tileSizeY: parsed.data.tileSizeY,
        columns: parsed.data.columns,
        rows: parsed.data.rows,
        campaignId: params.id,
        tiles: {
          create: tiles,
        },
      },
      include: { tiles: true },
    });

    reply.send({ tileSet });
  });

  fastify.get("/tilesets/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const tileSet = await prisma.tileSet.findUnique({
      where: { id: params.id },
      include: { campaign: true, tiles: true },
    });

    if (!tileSet) {
      reply.code(404).send({ error: "Tileset not found" });
      return;
    }

    const membership = await requireCampaignMember(request, reply, tileSet.campaignId);
    if (!membership) {
      return;
    }

    reply.send({ tileSet });
  });
}
