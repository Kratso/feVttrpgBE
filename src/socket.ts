import { Server as IOServer } from "socket.io";
import { FastifyInstance } from "fastify";
import { prisma } from "./plugins/db";

export function initSocket(fastify: FastifyInstance) {
  const io = new IOServer(fastify.server, {
    cors: {
      origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    socket.on("map:join", async ({ mapId }: { mapId: string }) => {
      socket.join(`map:${mapId}`);
    });

    socket.on(
      "token:move",
      async ({ mapId, tokenId, x, y }: { mapId: string; tokenId: string; x: number; y: number }) => {
        const token = await prisma.token.update({
          where: { id: tokenId },
          data: { x, y },
        });
        io.to(`map:${mapId}`).emit("token:moved", { token });
      }
    );
  });

  return io;
}
