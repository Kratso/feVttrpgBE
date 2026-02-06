import { FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifySession from "@fastify/session";

const SESSION_PREFIX = "sess:";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function registerSession(fastify: FastifyInstance) {
  await fastify.register(fastifyCookie);

  const store = {
    async set(sessionId: string, session: unknown, callback?: (err?: Error) => void) {
      try {
        const key = `${SESSION_PREFIX}${sessionId}`;
        const value = JSON.stringify(session);
        await fastify.redis.set(key, value, "EX", DEFAULT_TTL_SECONDS);
        callback?.();
      } catch (error) {
        callback?.(error as Error);
      }
    },
    async get(sessionId: string, callback: (err: Error | null, session?: unknown | null) => void) {
      try {
        const key = `${SESSION_PREFIX}${sessionId}`;
        const value = await fastify.redis.get(key);
        if (!value) {
          callback(null, null);
          return;
        }
        callback(null, JSON.parse(value));
      } catch (error) {
        callback(error as Error);
      }
    },
    async destroy(sessionId: string, callback?: (err?: Error) => void) {
      try {
        const key = `${SESSION_PREFIX}${sessionId}`;
        await fastify.redis.del(key);
        callback?.();
      } catch (error) {
        callback?.(error as Error);
      }
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
