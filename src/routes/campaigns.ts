import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../plugins/db";
import { getSessionUserId, requireAuth, requireDM, requireCampaignMember } from "../utils/auth";

const createCampaignSchema = z.object({
  name: z.string().min(2),
});

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["DM", "PLAYER"]).optional(),
});

export async function campaignRoutes(fastify: FastifyInstance) {
  fastify.get("/campaigns", async (request, reply) => {
    const authorized = await requireAuth(request, reply);
    if (!authorized) {
      return;
    }

    const userId = getSessionUserId(request);
    const memberships = await prisma.campaignMember.findMany({
      where: { userId: userId ?? "" },
      include: { campaign: true },
      orderBy: { campaign: { createdAt: "desc" } },
    });

    reply.send({
      campaigns: memberships.map(
        (m: { campaign: { id: string; name: string }; role: "DM" | "PLAYER" }) => ({
        id: m.campaign.id,
        name: m.campaign.name,
        role: m.role,
      })
      ),
    });
  });

  fastify.post("/campaigns", async (request, reply) => {
    const authorized = await requireAuth(request, reply);
    if (!authorized) {
      return;
    }

    const body = createCampaignSchema.parse(request.body);
    const userId = getSessionUserId(request);

    const campaign = await prisma.campaign.create({
      data: {
        name: body.name,
        createdById: userId ?? "",
        members: {
          create: {
            userId: userId ?? "",
            role: "DM",
          },
        },
      },
      select: { id: true, name: true },
    });

    reply.send({ campaign });
  });

  fastify.get("/campaigns/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const membership = await requireCampaignMember(request, reply, params.id);
    if (!membership) {
      return;
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: params.id },
      include: {
        members: {
          include: { user: { select: { id: true, email: true, displayName: true } } },
        },
      },
    });

    reply.send({ campaign });
  });

  fastify.get("/campaigns/:id/role", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const membership = await requireCampaignMember(request, reply, params.id);
    if (!membership) {
      return;
    }

    reply.send({ role: membership.role });
  });

  fastify.get("/campaigns/:id/members", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const membership = await requireCampaignMember(request, reply, params.id);
    if (!membership) {
      return;
    }

    const members = await prisma.campaignMember.findMany({
      where: { campaignId: params.id },
      include: { user: { select: { id: true, email: true, displayName: true } } },
    });

    reply.send({ members });
  });

  fastify.post("/campaigns/:id/members", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const dm = await requireDM(request, reply, params.id);
    if (!dm) {
      return;
    }

    const body = addMemberSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, email: true, displayName: true },
    });

    if (!user) {
      reply.code(404).send({ error: "User not found" });
      return;
    }

    const member = await prisma.campaignMember.upsert({
      where: {
        userId_campaignId: {
          userId: user.id,
          campaignId: params.id,
        },
      },
      create: {
        userId: user.id,
        campaignId: params.id,
        role: body.role ?? "PLAYER",
      },
      update: {
        role: body.role ?? "PLAYER",
      },
      include: { user: { select: { id: true, email: true, displayName: true } } },
    });

    reply.send({ member });
  });
}
