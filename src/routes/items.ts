import { FastifyInstance } from "fastify";
import { prisma } from "../plugins/db";
import { requireAuth } from "../utils/auth";

export async function itemRoutes(fastify: FastifyInstance) {
  fastify.get("/items", async (request, reply) => {
    const authorized = await requireAuth(request, reply);
    if (!authorized) {
      return;
    }

    const items = await prisma.item.findMany({
      orderBy: { name: "asc" },
    });

    reply.send({ items });
  });
}
