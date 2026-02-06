import "@fastify/session";

declare module "@fastify/session" {
  interface SessionData {
    userId?: string;
  }
}
