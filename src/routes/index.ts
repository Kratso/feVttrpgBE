import { FastifyInstance } from "fastify";
import { authRoutes } from "./auth";
import { campaignRoutes } from "./campaigns";
import { characterRoutes } from "./characters";
import { mapRoutes } from "./maps";
import { tokenRoutes } from "./tokens";
import { classRoutes } from "./classes";
import { itemRoutes } from "./items";

export async function registerRoutes(fastify: FastifyInstance) {
  await fastify.register(authRoutes, { prefix: "/api" });
  await fastify.register(campaignRoutes, { prefix: "/api" });
  await fastify.register(characterRoutes, { prefix: "/api" });
  await fastify.register(classRoutes, { prefix: "/api" });
  await fastify.register(itemRoutes, { prefix: "/api" });
  await fastify.register(mapRoutes, { prefix: "/api" });
  await fastify.register(tokenRoutes, { prefix: "/api" });
}
