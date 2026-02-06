import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../plugins/db";
import { getSessionUserId, requireAuth } from "../utils/auth";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().min(2),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/auth/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const existing = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (existing) {
      reply.code(400).send({ error: "Email already registered" });
      return;
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        displayName: body.displayName,
      },
      select: { id: true, email: true, displayName: true },
    });

    request.session.userId = user.id;
    reply.send({ user });
  });

  fastify.post("/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (!user) {
      reply.code(401).send({ error: "Invalid credentials" });
      return;
    }

    const match = await bcrypt.compare(body.password, user.passwordHash);
    if (!match) {
      reply.code(401).send({ error: "Invalid credentials" });
      return;
    }

    request.session.userId = user.id;
    reply.send({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    });
  });

  fastify.post("/auth/logout", async (request, reply) => {
    request.session.destroy((err) => {
      if (err) {
        reply.code(500).send({ error: "Failed to logout" });
        return;
      }
      reply.send({ ok: true });
    });
  });

  fastify.get("/auth/me", async (request, reply) => {
    const authorized = await requireAuth(request, reply);
    if (!authorized) {
      return;
    }

    const userId = getSessionUserId(request);
    const user = await prisma.user.findUnique({
      where: { id: userId ?? "" },
      select: { id: true, email: true, displayName: true },
    });

    reply.send({ user });
  });
}
