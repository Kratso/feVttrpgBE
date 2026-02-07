import { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MultipartFile } from "@fastify/multipart";
import crypto from "crypto";
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

const MAX_TILES = 4096;
const bufferToDataUrl = (buffer: Buffer) => `data:image/png;base64,${buffer.toString("base64")}`;

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
    try {
      const params = z.object({ id: z.string() }).parse(request.params);
      const dm = await requireDM(request, reply, params.id);
      if (!dm) {
        return;
      }

      if (!request.isMultipart()) {
        reply.code(400).send({ error: "Multipart form required" });
        return;
      }

      request.log.info("Tileset upload: reading multipart");
      const fields: Record<string, string> = {};
      let fileBuffer: Buffer | null = null;
      let fileName: string | undefined;

      for await (const part of request.parts()) {
        if (part.type === "file") {
          fileName = part.filename;
          fileBuffer = await part.toBuffer();
          continue;
        }
        fields[part.fieldname] = part.value;
      }

      if (!fileBuffer) {
        reply.code(400).send({ error: "Tileset image is required" });
        return;
      }

      request.log.info({ fields, fileName }, "Tileset upload: parsed fields");

      const parsed = tileSetUploadSchema.safeParse(fields);
      if (!parsed.success) {
        reply.code(400).send({ error: "Invalid upload fields", details: parsed.error.errors });
        return;
      }

      const totalTiles = parsed.data.columns * parsed.data.rows;
      if (totalTiles > MAX_TILES) {
        reply.code(400).send({ error: `Tileset too large (max ${MAX_TILES} tiles)` });
        return;
      }

      const metadata = await sharp(fileBuffer).metadata();
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
      const tilesetPng = await sharp(fileBuffer).png().toBuffer();
      const tilesetUrl = bufferToDataUrl(tilesetPng);

      request.log.info({ totalTiles }, "Tileset upload: slicing tiles");
      const tiles: Array<{ index: number; imageUrl: string }> = [];
      for (let row = 0; row < parsed.data.rows; row += 1) {
        for (let col = 0; col < parsed.data.columns; col += 1) {
          const index = row * parsed.data.columns + col;
          const tileBuffer = await sharp(fileBuffer)
            .extract({
              left: col * parsed.data.tileSizeX,
              top: row * parsed.data.tileSizeY,
              width: parsed.data.tileSizeX,
              height: parsed.data.tileSizeY,
            })
            .png()
            .toBuffer();
          tiles.push({
            index,
            imageUrl: bufferToDataUrl(tileBuffer),
          });
        }
      }

      request.log.info("Tileset upload: saving db records");
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
    } catch (error) {
      request.log.error({ err: error }, "Tileset upload failed");
      reply.code(500).send({ error: "Tileset upload failed" });
    }
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
