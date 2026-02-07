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

  it("creates a campaign", async () => {
    const { cookie } = await registerUser(app, {
      email: "create-campaign@test.com",
      password: "password123",
      displayName: "Create Campaign",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      headers: { cookie },
      payload: {
        name: "New Campaign",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().campaign.name).toBe("New Campaign");
  });

  it("returns campaign detail for members", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "campaign-detail@test.com",
      password: "password123",
      displayName: "Campaign Detail",
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

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().campaign.id).toBe(campaign.id);
  });

  it("prevents non-members from accessing campaign detail", async () => {
    const { cookie } = await registerUser(app, {
      email: "campaign-detail-forbidden@test.com",
      password: "password123",
      displayName: "Campaign Detail Forbidden",
    });

    const owner = await prisma.user.create({
      data: {
        email: "campaign-owner@test.com",
        displayName: "Campaign Owner",
        passwordHash: "hash",
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Other Campaign",
        createdById: owner.id,
        members: {
          create: {
            userId: owner.id,
            role: "DM",
          },
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns role for campaign members", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "campaign-role@test.com",
      password: "password123",
      displayName: "Campaign Role",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Role Campaign",
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
      method: "GET",
      url: `/api/campaigns/${campaign.id}/role`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe("PLAYER");
  });

  it("prevents non-members from reading roles", async () => {
    const { cookie } = await registerUser(app, {
      email: "campaign-role-forbidden@test.com",
      password: "password123",
      displayName: "Campaign Role Forbidden",
    });

    const owner = await prisma.user.create({
      data: {
        email: "campaign-role-owner@test.com",
        displayName: "Role Owner",
        passwordHash: "hash",
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Role Campaign",
        createdById: owner.id,
        members: {
          create: {
            userId: owner.id,
            role: "DM",
          },
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.id}/role`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
  });

  it("prevents non-members from listing members", async () => {
    const { cookie } = await registerUser(app, {
      email: "members-forbidden@test.com",
      password: "password123",
      displayName: "Members Forbidden",
    });

    const owner = await prisma.user.create({
      data: {
        email: "members-owner@test.com",
        displayName: "Members Owner",
        passwordHash: "hash",
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Members Campaign",
        createdById: owner.id,
        members: {
          create: {
            userId: owner.id,
            role: "DM",
          },
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.id}/members`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
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

  it("returns 404 when adding missing member", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "members-missing@test.com",
      password: "password123",
      displayName: "Members Missing",
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Missing Members Campaign",
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
      url: `/api/campaigns/${campaign.id}/members`,
      headers: { cookie },
      payload: {
        email: "unknown@test.com",
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it("prevents non-DM from adding members", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "members-non-dm@test.com",
      password: "password123",
      displayName: "Members Non DM",
    });

    const invitee = await prisma.user.create({
      data: {
        email: "members-non-dm-invite@test.com",
        displayName: "Members Invite",
        passwordHash: "hash",
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Members Non DM Campaign",
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
      url: `/api/campaigns/${campaign.id}/members`,
      headers: { cookie },
      payload: {
        email: invitee.email,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it("updates member role on upsert", async () => {
    const { cookie, user } = await registerUser(app, {
      email: "members-upsert@test.com",
      password: "password123",
      displayName: "Members Upsert",
    });

    const invitee = await prisma.user.create({
      data: {
        email: "members-upsert-invite@test.com",
        displayName: "Members Upsert Invite",
        passwordHash: "hash",
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Members Upsert Campaign",
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: "DM",
          },
        },
      },
    });

    await prisma.campaignMember.create({
      data: {
        userId: invitee.id,
        campaignId: campaign.id,
        role: "PLAYER",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.id}/members`,
      headers: { cookie },
      payload: {
        email: invitee.email,
        role: "DM",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().member.role).toBe("DM");
  });
});
