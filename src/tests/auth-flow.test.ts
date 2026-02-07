import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { setupTestApp, truncateAll } from "./helpers/testApp";

describe("auth flows", () => {
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

  it("registers a user and returns a session cookie", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "register@test.com",
        password: "password123",
        displayName: "Register Tester",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe("register@test.com");
    expect(response.headers["set-cookie"]).toBeTruthy();
  });

  it("logs in an existing user", async () => {
    const passwordHash = await bcrypt.hash("password123", 10);
    await prisma.user.create({
      data: {
        email: "login@test.com",
        displayName: "Login Tester",
        passwordHash,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "login@test.com",
        password: "password123",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe("login@test.com");
    expect(response.headers["set-cookie"]).toBeTruthy();
  });

  it("rejects duplicate registration", async () => {
    await prisma.user.create({
      data: {
        email: "dupe@test.com",
        displayName: "Dupe",
        passwordHash: "hash",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "dupe@test.com",
        password: "password123",
        displayName: "Dupe",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects invalid login credentials", async () => {
    const passwordHash = await bcrypt.hash("password123", 10);
    await prisma.user.create({
      data: {
        email: "invalid-login@test.com",
        displayName: "Invalid Login",
        passwordHash,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "invalid-login@test.com",
        password: "wrong-password",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects login for unknown user", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "missing@test.com",
        password: "password123",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns the current user for /auth/me", async () => {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "me@test.com",
        password: "password123",
        displayName: "Me Tester",
      },
    });

    const rawCookie = registerResponse.headers["set-cookie"];
    const cookie = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie;

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: cookie?.split(";")[0] ?? "" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe("me@test.com");
  });

  it("logs out and clears session", async () => {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "logout@test.com",
        password: "password123",
        displayName: "Logout Tester",
      },
    });

    const rawCookie = registerResponse.headers["set-cookie"];
    const cookie = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie;
    const sessionCookie = cookie?.split(";")[0] ?? "";

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: sessionCookie },
    });

    expect(logoutResponse.statusCode).toBe(200);

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: sessionCookie },
    });

    expect(meResponse.statusCode).toBe(401);
  });
});
