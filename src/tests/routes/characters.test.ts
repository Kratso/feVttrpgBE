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
});
