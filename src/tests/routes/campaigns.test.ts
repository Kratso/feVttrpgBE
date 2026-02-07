import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerUser, setupTestApp, truncateAll } from "../helpers/testApp";

describe("campaign routes", () => {
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

  it("returns campaign list for the user", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "campaigns@test.com",
      password: "password123",
      displayName: "Campaigns Tester",
    });

    await prisma.campaign.create({
      data: {
        name: "Test Campaign",
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
      method: "GET",
      url: "/api/campaigns",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().campaigns).toHaveLength(1);
  });

  it("manages campaign members", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "members-admin@test.com",
      password: "password123",
      displayName: "Members Admin",
    });

    const invitee = await prisma.user.create({
      data: {
        email: "invitee@test.com",
        displayName: "Invitee",
        passwordHash: "hash",
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Members Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "DM",
          },
        },
      },
    });

    const addResponse = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.id}/members`,
      headers: { cookie },
      payload: {
        email: invitee.email,
        role: "PLAYER",
      },
    });

    expect(addResponse.statusCode).toBe(200);
    expect(addResponse.json().member.user.email).toBe(invitee.email);

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.id}/members`,
      headers: { cookie },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().members).toHaveLength(2);
  });
});
