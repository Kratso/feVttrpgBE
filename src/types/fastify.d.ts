import "fastify";

declare module "fastify" {
  interface FastifyInstance {
    redis: {
      get: (key: string) => Promise<string | null>;
      set: (...args: Array<string | number>) => Promise<unknown>;
      del: (key: string) => Promise<number>;
    };
  }
}
