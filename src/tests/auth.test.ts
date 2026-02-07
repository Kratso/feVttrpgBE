import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { setupTestApp } from "./helpers/testApp";

describe("auth smoke", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const ctx = await setupTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("returns 401 for unauthenticated /auth/me", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 401 for unauthenticated /items", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/items",
    });

    expect(response.statusCode).toBe(401);
  });

  const protectedRoutes = [
    { method: "GET", url: "/api/classes" },
    { method: "GET", url: "/api/campaigns" },
    { method: "POST", url: "/api/campaigns" },
    { method: "GET", url: "/api/campaigns/test-id" },
    { method: "GET", url: "/api/campaigns/test-id/role" },
    { method: "GET", url: "/api/campaigns/test-id/members" },
    { method: "POST", url: "/api/campaigns/test-id/members" },
    { method: "GET", url: "/api/campaigns/test-id/characters" },
    { method: "POST", url: "/api/campaigns/test-id/characters" },
    { method: "GET", url: "/api/campaigns/test-id/maps" },
    { method: "POST", url: "/api/campaigns/test-id/maps" },
  ];

  protectedRoutes.forEach(({ method, url }) => {
    it(`returns 401 for unauthenticated ${method} ${url}`, async () => {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(401);
    });
  });
});
