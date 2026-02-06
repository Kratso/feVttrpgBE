import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerRedis } from "./plugins/redis";
import { registerSession } from "./plugins/session";
import { registerRoutes } from "./routes";
import { initSocket } from "./socket";

const app = Fastify({
  logger: true,
});

async function start() {
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });

  await registerRedis(app);
  await registerSession(app);
  await registerRoutes(app);

  initSocket(app);

  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
