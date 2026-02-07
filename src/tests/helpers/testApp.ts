import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import path from "node:path";
import dotenv from "dotenv";

export type TestContext = {
  app: FastifyInstance;
  prisma: PrismaClient;
};

export async function setupTestApp(): Promise<TestContext> {
  dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
  const testDbUrl = process.env.DATABASE_URL_TEST;
  if (!testDbUrl) {
    throw new Error("DATABASE_URL_TEST must be set for backend tests.");
  }

  process.env.DATABASE_URL = testDbUrl;

  const { prisma } = await import("../../plugins/db");
  const { buildApp } = await import("../../app");

  const app = await buildApp({ session: "memory" });
  await app.ready();

  return { app, prisma };
}

export async function truncateAll(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "CharacterItem",
      "CharacterSkill",
      "Token",
      "Map",
      "Character",
      "CampaignMember",
      "Campaign",
      "Item",
      "Skill",
      "GameClass",
      "User"
    RESTART IDENTITY CASCADE;
  `);
}

export async function registerUser(
  app: FastifyInstance,
  payload: { email: string; password: string; displayName: string }
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload,
  });

  const rawCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie;
  if (!cookie) {
    throw new Error("Expected auth cookie from register.");
  }

  return {
    cookie: cookie.split(";")[0],
    user: response.json().user as { id: string; email: string; displayName: string },
  };
}
