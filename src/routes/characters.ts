import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../plugins/db";
import { getSessionUserId, requireCampaignMember, requireDM } from "../utils/auth";
import { writeAuditLog } from "../utils/audit";

const statsSchema = z.union([
  z.record(z.string(), z.number()),
  z.object({
    baseStats: z.record(z.string(), z.number()).optional(),
    growths: z.record(z.string(), z.number()).optional(),
    bonusStats: z.record(z.string(), z.number()).optional(),
    weaponRanks: z.record(z.string(), z.string()).optional(),
  }),
]);

const characterSchema = z.object({
  name: z.string().min(2),
  stats: statsSchema,
  ownerId: z.string().optional(),
  kind: z.enum(["PLAYER", "NPC", "ENEMY"]).optional(),
  className: z.string().optional(),
  level: z.number().int().min(1).optional(),
  exp: z.number().int().min(0).optional(),
  weaponSkills: z
    .array(z.object({ weapon: z.string(), rank: z.string() }))
    .optional(),
  currentHp: z.number().int().min(0).optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  stats: statsSchema.optional(),
  ownerId: z.string().nullable().optional(),
  kind: z.enum(["PLAYER", "NPC", "ENEMY"]).optional(),
  className: z.string().nullable().optional(),
  level: z.number().int().min(1).optional(),
  exp: z.number().int().min(0).optional(),
  weaponSkills: z.array(z.object({ weapon: z.string(), rank: z.string() })).optional(),
  currentHp: z.number().int().min(0).optional(),
});

const inventoryAddSchema = z.object({
  itemId: z.string().min(1),
  uses: z.number().int().min(0).optional(),
});

const inventoryUpdateSchema = z.object({
  uses: z.number().int().min(0).nullable().optional(),
  blessed: z.boolean().optional(),
});

const inventoryOrderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(0).max(8),
});

const equippedWeaponSchema = z.object({
  inventoryId: z.string().min(1).nullable(),
});

const skillAddSchema = z.object({
  skillId: z.string().min(1),
});

const normalizeClassSkills = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const addMissingClassSkills = async (characterId: string, className: string | null) => {
  if (!className) return;

  const gameClass = await prisma.gameClass.findUnique({
    where: { name: className },
    select: { skills: true },
  });

  if (!gameClass) return;

  const classSkills = normalizeClassSkills(gameClass.skills);
  if (classSkills.length === 0) return;

  const availableSkills = await prisma.skill.findMany({
    where: { name: { in: classSkills } },
    select: { id: true },
  });

  if (availableSkills.length === 0) return;

  const existing = await prisma.characterSkill.findMany({
    where: { characterId },
    select: { skillId: true },
  });

  const existingIds = new Set(existing.map((entry) => entry.skillId));
  const toCreate = availableSkills
    .filter((entry) => !existingIds.has(entry.id))
    .map((entry) => ({ characterId, skillId: entry.id }));

  if (toCreate.length === 0) return;

  await prisma.characterSkill.createMany({ data: toCreate, skipDuplicates: true });
};

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
    const baseStats = (body.stats as { baseStats?: Record<string, number> })?.baseStats;
    const rawStats = body.stats as Record<string, number>;
    const baseHp = baseStats?.hp ?? rawStats?.hp ?? 0;

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
        currentHp: body.currentHp ?? baseHp,
        campaignId: params.id,
      },
      include: { owner: { select: { id: true, displayName: true } } },
    });

    await addMissingClassSkills(character.id, character.className ?? null);

    await writeAuditLog({
      entityType: "CHARACTER",
      entityId: character.id,
      action: "CHARACTER_CREATE",
      before: null,
      after: character,
      campaignId: character.campaignId,
      userId: dm.userId,
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
        skills: {
          include: { skill: true },
          orderBy: { skill: { name: "asc" } },
        },
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

  fastify.post("/characters/:id/skills", async (request, reply) => {
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

    const body = skillAddSchema.parse(request.body);
    const skill = await prisma.skill.findUnique({ where: { id: body.skillId } });
    if (!skill) {
      reply.code(404).send({ error: "Skill not found" });
      return;
    }

    const existingSkill = await prisma.characterSkill.findUnique({
      where: { characterId_skillId: { characterId: params.id, skillId: body.skillId } },
    });

    if (existingSkill) {
      reply.code(400).send({ error: "Skill already added" });
      return;
    }

    const characterSkill = await prisma.characterSkill.create({
      data: {
        characterId: params.id,
        skillId: body.skillId,
      },
      include: { skill: true },
    });

    reply.send({ characterSkill });
  });

  fastify.delete("/characters/:id/skills/:characterSkillId", async (request, reply) => {
    const params = z
      .object({ id: z.string(), characterSkillId: z.string() })
      .parse(request.params);
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

    const existing = await prisma.characterSkill.findUnique({
      where: { id: params.characterSkillId },
    });

    if (!existing || existing.characterId !== params.id) {
      reply.code(404).send({ error: "Skill not found" });
      return;
    }

    await prisma.characterSkill.delete({ where: { id: params.characterSkillId } });
    reply.send({ ok: true });
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

    await writeAuditLog({
      entityType: "CHARACTER",
      entityId: params.id,
      action: "INVENTORY_ADD",
      before: null,
      after: inventoryItem,
      campaignId: character.campaignId,
      userId: dm.userId,
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
    await writeAuditLog({
      entityType: "CHARACTER",
      entityId: params.id,
      action: "INVENTORY_REMOVE",
      before: inventoryItem,
      after: null,
      campaignId: character.campaignId,
      userId: dm.userId,
    });
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
        blessed: body.blessed === undefined ? inventoryItem.blessed : body.blessed,
      },
      include: { item: true },
    });

    await writeAuditLog({
      entityType: "CHARACTER",
      entityId: params.id,
      action: "INVENTORY_UPDATE",
      before: inventoryItem,
      after: updated,
      campaignId: character.campaignId,
      userId: membership.userId,
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
      select: { id: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
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

    await writeAuditLog({
      entityType: "CHARACTER",
      entityId: params.id,
      action: "INVENTORY_REORDER",
      before: inventory.map((entry) => entry.id),
      after: body.orderedIds,
      campaignId: character.campaignId,
      userId: membership.userId,
    });

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

      const restriction =
        inventoryItem.item.type?.toLowerCase() === "laguz"
          ? inventoryItem.item.classRestriction
          : null;
      if (restriction && membership.role !== "DM" && character.className !== restriction) {
        reply.code(403).send({
          error: `Laguz weapons are restricted to class: ${restriction}`,
        });
        return;
      }
    }

    const updated = await prisma.character.update({
      where: { id: params.id },
      data: { equippedWeaponItemId: body.inventoryId },
    });

    await writeAuditLog({
      entityType: "CHARACTER",
      entityId: params.id,
      action: "EQUIPPED_WEAPON_UPDATE",
      before: { equippedWeaponItemId: character.equippedWeaponItemId },
      after: { equippedWeaponItemId: body.inventoryId },
      campaignId: character.campaignId,
      userId: membership.userId,
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
    const nextKind = body.kind ?? existing.kind;
    const nextOwnerId = nextKind === "PLAYER" ? (body.ownerId ?? existing.ownerId) : null;
    const character = await prisma.character.update({
      where: { id: params.id },
      data: {
        name: body.name ?? existing.name,
        stats: body.stats ?? (existing.stats as Record<string, number>),
        ownerId: nextOwnerId,
        kind: nextKind,
        className: body.className === undefined ? existing.className : body.className,
        level: body.level ?? existing.level,
        exp: body.exp ?? existing.exp,
        weaponSkills: body.weaponSkills ?? (existing.weaponSkills as Array<{ weapon: string; rank: string }> | null),
        currentHp: body.currentHp ?? existing.currentHp,
      },
    });

    await addMissingClassSkills(character.id, character.className ?? null);

    await writeAuditLog({
      entityType: "CHARACTER",
      entityId: character.id,
      action: "CHARACTER_UPDATE",
      before: existing,
      after: character,
      campaignId: character.campaignId,
      userId: dm.userId,
    });

    reply.send({ character });
  });

  fastify.patch("/characters/:id/hp", async (request, reply) => {
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

    const body = z.object({ currentHp: z.number().int().min(0) }).parse(request.body);
    const updated = await prisma.character.update({
      where: { id: params.id },
      data: { currentHp: body.currentHp },
    });

    await writeAuditLog({
      entityType: "CHARACTER",
      entityId: params.id,
      action: "HP_UPDATE",
      before: { currentHp: character.currentHp },
      after: { currentHp: body.currentHp },
      campaignId: character.campaignId,
      userId: membership.userId,
    });

    reply.send({ character: updated });
  });
}
