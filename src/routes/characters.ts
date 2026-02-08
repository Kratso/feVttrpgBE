import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../plugins/db";
import { getSessionUserId, requireCampaignMember, requireDM } from "../utils/auth";

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

const inventoryAddSchema = z.object({
  itemId: z.string().min(1),
  uses: z.number().int().min(0).optional(),
});

const inventoryUpdateSchema = z.object({
  uses: z.number().int().min(0).nullable().optional(),
});

const inventoryOrderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(0).max(8),
});

const equippedWeaponSchema = z.object({
  inventoryId: z.string().min(1).nullable(),
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
      include: {
        owner: { select: { id: true, displayName: true } },
        campaign: true,
        inventory: {
          include: { item: true },
          orderBy: { sortOrder: "asc" },
        },
        equippedWeaponItem: { include: { item: true } },
      },
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

  fastify.get("/characters/:id/inventory", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const character = await prisma.character.findUnique({
      where: { id: params.id },
      include: { campaign: true },
    });

    if (!character) {
      reply.code(404).send({ error: "Character not found" });
      return;
    }

    const membership = await requireCampaignMember(request, reply, character.campaignId);
    if (!membership) {
      return;
    }

    const inventory = await prisma.characterItem.findMany({
      where: { characterId: params.id },
      include: { item: true },
      orderBy: { sortOrder: "asc" },
    });

    reply.send({ inventory, equippedWeaponItemId: character.equippedWeaponItemId });
  });

  fastify.post("/characters/:id/inventory", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const character = await prisma.character.findUnique({
      where: { id: params.id },
    });

    if (!character) {
      reply.code(404).send({ error: "Character not found" });
      return;
    }

    const dm = await requireDM(request, reply, character.campaignId);
    if (!dm) {
      return;
    }

    const body = inventoryAddSchema.parse(request.body);
    const item = await prisma.item.findUnique({ where: { id: body.itemId } });
    if (!item) {
      reply.code(404).send({ error: "Item not found" });
      return;
    }

    const count = await prisma.characterItem.count({ where: { characterId: params.id } });
    if (count >= 8) {
      reply.code(400).send({ error: "Inventory is full" });
      return;
    }

    const maxOrder = await prisma.characterItem.aggregate({
      where: { characterId: params.id },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    const inventoryItem = await prisma.characterItem.create({
      data: {
        characterId: params.id,
        itemId: body.itemId,
        sortOrder,
        uses: body.uses ?? item.uses ?? null,
      },
      include: { item: true },
    });

    reply.send({ inventoryItem });
  });

  fastify.delete("/characters/:id/inventory/:inventoryId", async (request, reply) => {
    const params = z.object({ id: z.string(), inventoryId: z.string() }).parse(request.params);
    const character = await prisma.character.findUnique({
      where: { id: params.id },
    });

    if (!character) {
      reply.code(404).send({ error: "Character not found" });
      return;
    }

    const dm = await requireDM(request, reply, character.campaignId);
    if (!dm) {
      return;
    }

    const inventoryItem = await prisma.characterItem.findUnique({
      where: { id: params.inventoryId },
    });

    if (!inventoryItem || inventoryItem.characterId !== params.id) {
      reply.code(404).send({ error: "Inventory item not found" });
      return;
    }

    await prisma.characterItem.delete({ where: { id: params.inventoryId } });
    reply.send({ ok: true });
  });

  fastify.patch("/characters/:id/inventory/:inventoryId", async (request, reply) => {
    const params = z.object({ id: z.string(), inventoryId: z.string() }).parse(request.params);
    const character = await prisma.character.findUnique({
      where: { id: params.id },
    });

    if (!character) {
      reply.code(404).send({ error: "Character not found" });
      return;
    }

    const membership = await requireCampaignMember(request, reply, character.campaignId);
    if (!membership) {
      return;
    }

    const userId = getSessionUserId(request);
    const canEdit = membership.role === "DM" || (character.ownerId && character.ownerId === userId);
    if (!canEdit) {
      reply.code(403).send({ error: "Forbidden" });
      return;
    }

    const body = inventoryUpdateSchema.parse(request.body);
    const inventoryItem = await prisma.characterItem.findUnique({
      where: { id: params.inventoryId },
    });

    if (!inventoryItem || inventoryItem.characterId !== params.id) {
      reply.code(404).send({ error: "Inventory item not found" });
      return;
    }

    const updated = await prisma.characterItem.update({
      where: { id: params.inventoryId },
      data: {
        uses: body.uses === undefined ? inventoryItem.uses : body.uses,
      },
      include: { item: true },
    });

    reply.send({ inventoryItem: updated });
  });

  fastify.put("/characters/:id/inventory/order", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const character = await prisma.character.findUnique({
      where: { id: params.id },
    });

    if (!character) {
      reply.code(404).send({ error: "Character not found" });
      return;
    }

    const membership = await requireCampaignMember(request, reply, character.campaignId);
    if (!membership) {
      return;
    }

    const userId = getSessionUserId(request);
    const canEdit = membership.role === "DM" || (character.ownerId && character.ownerId === userId);
    if (!canEdit) {
      reply.code(403).send({ error: "Forbidden" });
      return;
    }

    const body = inventoryOrderSchema.parse(request.body);
    const inventory = await prisma.characterItem.findMany({
      where: { characterId: params.id },
      select: { id: true },
    });

    if (inventory.length !== body.orderedIds.length) {
      reply.code(400).send({ error: "Order list does not match inventory" });
      return;
    }

    const inventoryIds = new Set(inventory.map((entry) => entry.id));
    const hasAll = body.orderedIds.every((id) => inventoryIds.has(id));
    if (!hasAll) {
      reply.code(400).send({ error: "Order list does not match inventory" });
      return;
    }

    await prisma.$transaction(
      body.orderedIds.map((id, index) =>
        prisma.characterItem.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );

    reply.send({ ok: true });
  });

  fastify.put("/characters/:id/equipped-weapon", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const character = await prisma.character.findUnique({
      where: { id: params.id },
    });

    if (!character) {
      reply.code(404).send({ error: "Character not found" });
      return;
    }

    const membership = await requireCampaignMember(request, reply, character.campaignId);
    if (!membership) {
      return;
    }

    const userId = getSessionUserId(request);
    const canEdit = membership.role === "DM" || (character.ownerId && character.ownerId === userId);
    if (!canEdit) {
      reply.code(403).send({ error: "Forbidden" });
      return;
    }

    const body = equippedWeaponSchema.parse(request.body);
    if (body.inventoryId) {
      const inventoryItem = await prisma.characterItem.findUnique({
        where: { id: body.inventoryId },
        include: { item: true },
      });

      if (!inventoryItem || inventoryItem.characterId !== params.id) {
        reply.code(404).send({ error: "Inventory item not found" });
        return;
      }

      if (inventoryItem.item.category !== "WEAPON") {
        reply.code(400).send({ error: "Only weapons can be equipped" });
        return;
      }
    }

    const updated = await prisma.character.update({
      where: { id: params.id },
      data: { equippedWeaponItemId: body.inventoryId },
    });

    reply.send({ character: updated });
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
