import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";

describe("auth smoke", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ session: "memory" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
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
});
