import { buildApp } from "./app";
import { initSocket } from "./socket";

async function start() {
  const app = await buildApp();
  initSocket(app);
  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
