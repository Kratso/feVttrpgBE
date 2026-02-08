import { FastifyInstance } from "fastify";
import { prisma } from "../plugins/db";
import { requireAuth } from "../utils/auth";

export async function skillRoutes(fastify: FastifyInstance) {
  fastify.get("/skills", async (request, reply) => {
    const authed = await requireAuth(request, reply);
    if (!authed) {
      return;
    }

    const skills = await prisma.skill.findMany({
      orderBy: { name: "asc" },
    });

    reply.send({ skills });
  });
}
