import { FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifySession from "@fastify/session";
import type { SessionStore } from "@fastify/session";
import type { Session } from "fastify";

const SESSION_PREFIX = "sess:";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function registerSession(fastify: FastifyInstance) {
  await fastify.register(fastifyCookie);

  const store: SessionStore = {
    set(sessionId: string, session: Session, callback) {
      const key = `${SESSION_PREFIX}${sessionId}`;
      const value = JSON.stringify(session);
      fastify.redis
        .set(key, value, "EX", DEFAULT_TTL_SECONDS)
        .then(() => callback())
        .catch((error) => callback(error as Error));
    },
    get(sessionId: string, callback) {
      const key = `${SESSION_PREFIX}${sessionId}`;
      fastify.redis
        .get(key)
        .then((value) => {
          if (!value) {
            callback(null, null);
            return;
          }
          callback(null, JSON.parse(value));
        })
        .catch((error) => callback(error as Error));
    },
    destroy(sessionId: string, callback) {
      const key = `${SESSION_PREFIX}${sessionId}`;
      fastify.redis
        .del(key)
        .then(() => callback())
        .catch((error) => callback(error as Error));
    },
  };

  await fastify.register(fastifySession, {
    secret: process.env.SESSION_SECRET ?? "dev-secret",
    cookie: {
      secure: false,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: DEFAULT_TTL_SECONDS,
    },
    store,
    saveUninitialized: false,
  });
}
