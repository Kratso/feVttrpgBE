import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import fastifySession from "@fastify/session";
import { ZodError } from "zod";
import { registerRedis } from "./plugins/redis";
import { registerSession } from "./plugins/session";
import { registerRoutes } from "./routes";

export type AppOptions = {
  session?: "redis" | "memory";
};

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: true });

  const sessionSecret = (process.env.SESSION_SECRET ?? "dev-secret").padEnd(32, "0");

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({ error: "Invalid request", details: error.errors });
      return;
    }
    reply.send(error);
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });

  if (options.session === "memory") {
    await app.register(fastifyCookie);
    await app.register(fastifySession, {
      secret: sessionSecret,
      cookie: {
        secure: false,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      },
      saveUninitialized: false,
    });
  } else {
    await registerRedis(app);
    await registerSession(app);
  }

  await registerRoutes(app);

  return app;
}
