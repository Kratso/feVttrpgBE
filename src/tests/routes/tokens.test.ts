import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerUser, setupTestApp, truncateAll } from "../helpers/testApp";

describe("token routes", () => {
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

  it("creates and lists tokens for a DM", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "maps@test.com",
      password: "password123",
      displayName: "Maps Tester",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Map Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "DM",
          },
        },
      },
    });

    const map = await prisma.map.create({
      data: {
        name: "Arena",
        imageUrl: "https://example.com/map.png",
        gridSize: 50,
        gridOffsetX: 0,
        gridOffsetY: 0,
        campaignId: campaign.id,
      },
    });

    const tokenResponse = await app.inject({
      method: "POST",
      url: `/api/maps/${map.id}/tokens`,
      headers: { cookie },
      payload: {
        label: "A",
        x: 1,
        y: 2,
      },
    });

    expect(tokenResponse.statusCode).toBe(200);

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/maps/${map.id}/tokens`,
      headers: { cookie },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().tokens).toHaveLength(1);
  });

  it("prevents non-members from listing tokens", async () => {
    const { cookie } = await registerUser(app, {
      email: "token-list-forbidden@test.com",
      password: "password123",
      displayName: "Token List Forbidden",
    });

    const owner = await prisma.user.create({
      data: {
        email: "token-owner@test.com",
        displayName: "Token Owner",
        passwordHash: "hash",
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Token Campaign",
        createdById: owner.id,
        members: {
          create: {
            userId: owner.id,
            role: "DM",
          },
        },
      },
    });

    const map = await prisma.map.create({
      data: {
        name: "Token Map",
        imageUrl: "https://example.com/token-map.png",
        gridSize: 50,
        gridOffsetX: 0,
        gridOffsetY: 0,
        campaignId: campaign.id,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/maps/${map.id}/tokens`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns 404 when listing tokens for missing map", async () => {
    const { cookie } = await registerUser(app, {
      email: "token-404@test.com",
      password: "password123",
      displayName: "Token 404 Tester",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/maps/missing-map/tokens",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it("prevents non-DM from creating tokens", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "token-create-player@test.com",
      password: "password123",
      displayName: "Token Create Player",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Token Create Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "PLAYER",
          },
        },
      },
    });

    const map = await prisma.map.create({
      data: {
        name: "Token Create Map",
        imageUrl: "https://example.com/token-create.png",
        gridSize: 50,
        gridOffsetX: 0,
        gridOffsetY: 0,
        campaignId: campaign.id,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/maps/${map.id}/tokens`,
      headers: { cookie },
      payload: {
        label: "B",
        x: 1,
        y: 1,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns 404 for missing token update", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "token-update-404@test.com",
      password: "password123",
      displayName: "Token Update 404",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Token Update Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "DM",
          },
        },
      },
    });

    const map = await prisma.map.create({
      data: {
        name: "Token Update Map",
        imageUrl: "https://example.com/token-update.png",
        gridSize: 50,
        gridOffsetX: 0,
        gridOffsetY: 0,
        campaignId: campaign.id,
      },
    });

    const response = await app.inject({
      method: "PUT",
      url: "/api/tokens/missing-token",
      headers: { cookie },
      payload: {
        x: 4,
        y: 5,
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it("prevents non-DM from updating tokens", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "token-update-player@test.com",
      password: "password123",
      displayName: "Token Update Player",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Token Update Player Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "PLAYER",
          },
        },
      },
    });

    const map = await prisma.map.create({
      data: {
        name: "Token Update Player Map",
        imageUrl: "https://example.com/token-update-player.png",
        gridSize: 50,
        gridOffsetX: 0,
        gridOffsetY: 0,
        campaignId: campaign.id,
      },
    });

    const token = await prisma.token.create({
      data: {
        mapId: map.id,
        label: "T",
        x: 0,
        y: 0,
      },
    });

    const response = await app.inject({
      method: "PUT",
      url: `/api/tokens/${token.id}`,
      headers: { cookie },
      payload: {
        x: 2,
        y: 2,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it("updates a token position", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "token-update@test.com",
      password: "password123",
      displayName: "Token Update Tester",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Token Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "DM",
          },
        },
      },
    });

    const map = await prisma.map.create({
      data: {
        name: "Token Map",
        imageUrl: "https://example.com/token-map.png",
        gridSize: 50,
        gridOffsetX: 0,
        gridOffsetY: 0,
        campaignId: campaign.id,
      },
    });

    const token = await prisma.token.create({
      data: {
        mapId: map.id,
        label: "T",
        x: 0,
        y: 0,
      },
    });

    const response = await app.inject({
      method: "PUT",
      url: `/api/tokens/${token.id}`,
      headers: { cookie },
      payload: {
        x: 3,
        y: 4,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().token.x).toBe(3);
    expect(response.json().token.y).toBe(4);
  });
});
