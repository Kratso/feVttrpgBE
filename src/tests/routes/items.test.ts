import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerUser, setupTestApp, truncateAll } from "../helpers/testApp";

describe("item routes", () => {
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

  it("lists items for an authenticated user", async () => {
    const { cookie } = await registerUser(app, {
      email: "items@test.com",
      password: "password123",
      displayName: "Items Tester",
    });

    await prisma.item.create({
      data: {
        name: "Iron Sword",
        type: "sword",
        category: "WEAPON",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/items",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
  });
});
