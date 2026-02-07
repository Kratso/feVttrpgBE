import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerUser, setupTestApp, truncateAll } from "../helpers/testApp";

describe("class routes", () => {
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

  it("lists classes for an authenticated user", async () => {
    const { cookie } = await registerUser(app, {
      email: "classes@test.com",
      password: "password123",
      displayName: "Classes Tester",
    });

    await prisma.gameClass.create({
      data: {
        name: "Fighter",
        description: "Frontline class",
        growths: {},
        baseStats: {},
        maxStats: {},
        weaponRanks: {},
        promotesTo: [],
        skills: [],
        types: [],
        powerBonus: 0,
        expBonus: 0,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/classes",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().classes).toHaveLength(1);
  });
});
