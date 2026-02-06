import { FastifyInstance } from "fastify";
import fastifyRedis from "@fastify/redis";

export async function registerRedis(fastify: FastifyInstance) {
  await fastify.register(fastifyRedis, {
    url: process.env.REDIS_URL,
  });
}
