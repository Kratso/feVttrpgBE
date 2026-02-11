import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerUser, setupTestApp, truncateAll } from "../helpers/testApp";

describe("character routes", () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const ctx = await setupTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it("creates and lists characters for a campaign", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "characters@test.com",
      password: "password123",
      displayName: "Characters Tester",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Character Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "DM",
          },
        },
      },
    });

    const createResponse = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.id}/characters`,
      headers: { cookie },
      payload: {
        name: "Ike",
        stats: { hp: 20 },
        kind: "PLAYER",
      },
    });

    expect(createResponse.statusCode).toBe(200);

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.id}/characters`,
      headers: { cookie },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().characters).toHaveLength(1);
  });

  it("returns character detail for campaign members", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "character-detail@test.com",
      password: "password123",
      displayName: "Character Detail Tester",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Character Detail Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "DM",
          },
        },
      },
    });

    const character = await prisma.character.create({
      data: {
        name: "Mia",
        stats: { hp: 19 },
        kind: "PLAYER",
        campaignId: campaign.id,
        ownerId: user.id,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/characters/${character.id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().character.id).toBe(character.id);
  });

  it("returns 404 for missing character detail", async () => {
    const { cookie } = await registerUser(app, {
      email: "character-404@test.com",
      password: "password123",
      displayName: "Character 404",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/characters/missing-character",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it("prevents non-members from reading character detail", async () => {
    const { cookie } = await registerUser(app, {
      email: "character-forbidden@test.com",
      password: "password123",
      displayName: "Character Forbidden",
    });

    const owner = await prisma.user.create({
      data: {
        email: "character-owner@test.com",
        displayName: "Character Owner",
        passwordHash: "hash",
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Character Forbidden Campaign",
        createdById: owner.id,
        members: {
          create: {
            userId: owner.id,
            role: "DM",
          },
        },
      },
    });

    const character = await prisma.character.create({
      data: {
        name: "Zihark",
        stats: { hp: 22 },
        kind: "PLAYER",
        campaignId: campaign.id,
        ownerId: owner.id,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/characters/${character.id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
  });

  it("prevents non-DM from creating characters", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "character-create-player@test.com",
      password: "password123",
      displayName: "Character Create Player",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Character Create Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "PLAYER",
          },
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.id}/characters`,
      headers: { cookie },
      payload: {
        name: "Nephenee",
        stats: { hp: 21 },
        kind: "PLAYER",
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it("creates NPC without an owner", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "character-npc@test.com",
      password: "password123",
      displayName: "Character NPC",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "NPC Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "DM",
          },
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.id}/characters`,
      headers: { cookie },
      payload: {
        name: "Bandit",
        stats: { hp: 15 },
        kind: "NPC",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().character.ownerId).toBeNull();
  });

  it("updates blessed flag on inventory items", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "character-blessed@test.com",
      password: "password123",
      displayName: "Character Blessed",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Blessed Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "DM",
          },
        },
      },
    });

    const item = await prisma.item.create({
      data: {
        name: "Blessed Blade",
        type: "sword",
        category: "WEAPON",
        might: 5,
        hit: 80,
        weight: 3,
      },
    });

    const character = await prisma.character.create({
      data: {
        name: "Titania",
        stats: { hp: 24 },
        kind: "PLAYER",
        campaignId: campaign.id,
        ownerId: user.id,
      },
    });

    const addResponse = await app.inject({
      method: "POST",
      url: `/api/characters/${character.id}/inventory`,
      headers: { cookie },
      payload: { itemId: item.id },
    });

    expect(addResponse.statusCode).toBe(200);
    const inventoryId = addResponse.json().inventoryItem.id as string;

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/characters/${character.id}/inventory/${inventoryId}`,
      headers: { cookie },
      payload: { blessed: true },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().inventoryItem.blessed).toBe(true);
  });

  it("updates a character", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "character-update@test.com",
      password: "password123",
      displayName: "Character Update Tester",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Update Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "DM",
          },
        },
      },
    });

    const character = await prisma.character.create({
      data: {
        name: "Soren",
        stats: { hp: 18 },
        kind: "PLAYER",
        campaignId: campaign.id,
        ownerId: user.id,
      },
    });

    const response = await app.inject({
      method: "PUT",
      url: `/api/characters/${character.id}`,
      headers: { cookie },
      payload: {
        name: "Soren Updated",
        stats: { hp: 20 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().character.name).toBe("Soren Updated");
    expect(response.json().character.stats.hp).toBe(20);
  });

  it("returns 404 when updating a missing character", async () => {
    const { cookie } = await registerUser(app, {
      email: "character-update-404@test.com",
      password: "password123",
      displayName: "Character Update 404",
    });

    const response = await app.inject({
      method: "PUT",
      url: "/api/characters/missing-character",
      headers: { cookie },
      payload: {
        name: "Missing",
        stats: { hp: 1 },
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it("prevents non-DM from updating a character", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "character-update-player@test.com",
      password: "password123",
      displayName: "Character Update Player",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Character Update Player Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "PLAYER",
          },
        },
      },
    });

    const character = await prisma.character.create({
      data: {
        name: "Rolf",
        stats: { hp: 16 },
        kind: "PLAYER",
        campaignId: campaign.id,
        ownerId: user.id,
      },
    });

    const response = await app.inject({
      method: "PUT",
      url: `/api/characters/${character.id}`,
      headers: { cookie },
      payload: {
        name: "Rolf Updated",
        stats: { hp: 18 },
      },
    });

    expect(response.statusCode).toBe(403);
  });
});
