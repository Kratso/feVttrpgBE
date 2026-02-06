import { FastifyInstance } from "fastify";
import { prisma } from "../plugins/db";
import { requireAuth } from "../utils/auth";

export async function classRoutes(fastify: FastifyInstance) {
  fastify.get("/classes", async (request, reply) => {
    const authorized = await requireAuth(request, reply);
    if (!authorized) {
      return;
    }

    const classes = await prisma.gameClass.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        baseStats: true,
        growths: true,
        maxStats: true,
        weaponRanks: true,
        promotesTo: true,
        skills: true,
        types: true,
        powerBonus: true,
        expBonus: true,
      },
      orderBy: { name: "asc" },
    });

    reply.send({ classes });
  });
}
