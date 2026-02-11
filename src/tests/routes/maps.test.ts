import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerUser, setupTestApp, truncateAll } from "../helpers/testApp";

describe("map routes", () => {
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

  it("creates a map for a DM", async () => {
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

    const mapResponse = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.id}/maps`,
      headers: { cookie },
      payload: {
        name: "Arena",
        imageUrl: "https://example.com/map.png",
        gridSizeX: 50,
        gridSizeY: 50,
      },
    });

    expect(mapResponse.statusCode).toBe(200);
    expect(mapResponse.json().map.name).toBe("Arena");
  });

  it("rejects invalid map payloads", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "maps-invalid@test.com",
      password: "password123",
      displayName: "Maps Invalid",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Map Invalid Campaign",
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
      url: `/api/campaigns/${campaign.id}/maps`,
      headers: { cookie },
      payload: {
        name: "A",
        imageUrl: "not-a-url",
        gridSizeX: 5,
        gridSizeY: 5,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("lists maps for campaign members", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "map-list@test.com",
      password: "password123",
      displayName: "Map List Tester",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Map List Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "DM",
          },
        },
      },
    });

    await prisma.map.create({
      data: {
        name: "List Map",
        imageUrl: "https://example.com/list.png",
        gridSizeX: 50,
        gridSizeY: 50,
        gridOffsetX: 0,
        gridOffsetY: 0,
        campaignId: campaign.id,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.id}/maps`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().maps).toHaveLength(1);
  });

  it("allows PLAYER members to list maps", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "map-list-player@test.com",
      password: "password123",
      displayName: "Map List Player",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Map List Player Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "PLAYER",
          },
        },
      },
    });

    await prisma.map.create({
      data: {
        name: "Player Map",
        imageUrl: "https://example.com/player-map.png",
        gridSizeX: 50,
        gridSizeY: 50,
        gridOffsetX: 0,
        gridOffsetY: 0,
        campaignId: campaign.id,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.id}/maps`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().maps).toHaveLength(1);
  });

  it("prevents non-members from listing maps", async () => {
    const { cookie } = await registerUser(app, {
      email: "map-forbidden@test.com",
      password: "password123",
      displayName: "Map Forbidden",
    });

    const otherUser = await prisma.user.create({
      data: {
        email: "map-owner@test.com",
        displayName: "Map Owner",
        passwordHash: "hash",
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Other Campaign",
        createdById: otherUser.id,
        members: {
          create: {
            userId: otherUser.id,
            role: "DM",
          },
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.id}/maps`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns 404 for missing map detail", async () => {
    const { cookie } = await registerUser(app, {
      email: "map-404@test.com",
      password: "password123",
      displayName: "Map 404 Tester",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/maps/missing-map",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it("prevents non-members from fetching map detail", async () => {
    const { cookie } = await registerUser(app, {
      email: "map-detail-forbidden@test.com",
      password: "password123",
      displayName: "Map Detail Forbidden",
    });

    const owner = await prisma.user.create({
      data: {
        email: "map-detail-owner@test.com",
        displayName: "Map Detail Owner",
        passwordHash: "hash",
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Map Detail Campaign",
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
        name: "Hidden Map",
        imageUrl: "https://example.com/hidden.png",
        gridSizeX: 40,
        gridSizeY: 40,
        gridOffsetX: 0,
        gridOffsetY: 0,
        campaignId: campaign.id,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/maps/${map.id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
  });

  it("creates and lists roll logs for map members", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "map-rolls@test.com",
      password: "password123",
      displayName: "Map Rolls",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Map Roll Campaign",
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
        name: "Roll Map",
        imageUrl: "https://example.com/roll-map.png",
        gridSizeX: 50,
        gridSizeY: 50,
        gridOffsetX: 0,
        gridOffsetY: 0,
        campaignId: campaign.id,
      },
    });

    const rollA = await app.inject({
      method: "POST",
      url: `/api/maps/${map.id}/rolls`,
      headers: { cookie },
      payload: { type: "REGULAR" },
    });

    expect(rollA.statusCode).toBe(200);
    expect(rollA.json().roll.type).toBe("REGULAR");
    expect(rollA.json().roll.result).toBeGreaterThanOrEqual(1);
    expect(rollA.json().roll.result).toBeLessThanOrEqual(100);

    const rollB = await app.inject({
      method: "POST",
      url: `/api/maps/${map.id}/rolls`,
      headers: { cookie },
      payload: { type: "COMBAT" },
    });

    expect(rollB.statusCode).toBe(200);
    expect(rollB.json().roll.type).toBe("COMBAT");
    expect(rollB.json().roll.result).toBeGreaterThanOrEqual(1);
    expect(rollB.json().roll.result).toBeLessThanOrEqual(100);

    const list = await app.inject({
      method: "GET",
      url: `/api/maps/${map.id}/rolls`,
      headers: { cookie },
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().rolls).toHaveLength(2);
    expect(list.json().rolls[0].id).toBe(rollB.json().roll.id);
  });

  it("prevents non-members from creating roll logs", async () => {
    const { cookie } = await registerUser(app, {
      email: "map-rolls-forbidden@test.com",
      password: "password123",
      displayName: "Map Rolls Forbidden",
    });

    const owner = await prisma.user.create({
      data: {
        email: "map-rolls-owner@test.com",
        displayName: "Map Rolls Owner",
        passwordHash: "hash",
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Map Roll Forbidden Campaign",
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
        name: "Roll Map Forbidden",
        imageUrl: "https://example.com/roll-map.png",
        gridSizeX: 50,
        gridSizeY: 50,
        gridOffsetX: 0,
        gridOffsetY: 0,
        campaignId: campaign.id,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/maps/${map.id}/rolls`,
      headers: { cookie },
      payload: { type: "REGULAR" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns map details for campaign members", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "map-detail@test.com",
      password: "password123",
      displayName: "Map Detail Tester",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Detail Campaign",
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
        name: "Bridge",
        imageUrl: "https://example.com/bridge.png",
        gridSizeX: 40,
        gridSizeY: 40,
        gridOffsetX: 0,
        gridOffsetY: 0,
        campaignId: campaign.id,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/maps/${map.id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().map.id).toBe(map.id);
  });

  it("prevents non-DM from creating a map", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "map-create-player@test.com",
      password: "password123",
      displayName: "Map Create Player",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Map Create Campaign",
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
      url: `/api/campaigns/${campaign.id}/maps`,
      headers: { cookie },
      payload: {
        name: "Unauthorized Map",
        imageUrl: "https://example.com/nope.png",
        gridSizeX: 50,
        gridSizeY: 50,
      },
    });

    expect(response.statusCode).toBe(403);
  });
});
