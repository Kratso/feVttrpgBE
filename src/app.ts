import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import fastifySession from "@fastify/session";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { ZodError } from "zod";
import path from "path";
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

  const corsOrigins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (corsOrigins.length === 0 || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed"), false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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

  await app.register(swagger, {
    openapi: {
      info: {
        title: "FeVTTRPG API",
        description: "Backend API for campaigns, characters, items, maps, and auth.",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          sessionCookie: {
            type: "apiKey",
            in: "cookie",
            name: "sessionId",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
    },
  });

  const uploadRoot = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
  await app.register(fastifyStatic, {
    root: uploadRoot,
    prefix: "/uploads/",
  });

  await registerRoutes(app);

  return app;
}
