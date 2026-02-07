import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import fastifySession from "@fastify/session";
import { registerRedis } from "./plugins/redis";
import { registerSession } from "./plugins/session";
import { registerRoutes } from "./routes";

export type AppOptions = {
  session?: "redis" | "memory";
};

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });

  if (options.session === "memory") {
    await app.register(fastifyCookie);
    await app.register(fastifySession, {
      secret: process.env.SESSION_SECRET ?? "dev-secret",
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
