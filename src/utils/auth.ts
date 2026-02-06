import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../plugins/db";

export function getSessionUserId(request: FastifyRequest) {
  return request.session.userId ?? null;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const userId = getSessionUserId(request);
  if (!userId) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

export async function requireCampaignMember(
  request: FastifyRequest,
  reply: FastifyReply,
  campaignId: string
) {
  const userId = getSessionUserId(request);
  if (!userId) {
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }

  const membership = await prisma.campaignMember.findUnique({
    where: {
      userId_campaignId: {
        userId,
        campaignId,
      },
    },
  });

  if (!membership) {
    reply.code(403).send({ error: "Forbidden" });
    return null;
  }

  return membership;
}

export async function requireDM(
  request: FastifyRequest,
  reply: FastifyReply,
  campaignId: string
) {
  const membership = await requireCampaignMember(request, reply, campaignId);
  if (!membership) {
    return null;
  }

  if (membership.role !== "DM") {
    reply.code(403).send({ error: "DM role required" });
    return null;
  }

  return membership;
}
