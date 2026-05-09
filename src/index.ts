import Fastify from "fastify";
import Redis from "ioredis";
import { env } from "./config/env.js";
import { closeDb, query } from "./db/db.js";
import { closeQueue } from "./queue/queue.js";
import { refreshRoutes } from "./routes/refreshRoutes.js";

const app = Fastify({
  logger: true
});

const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: 1,
  lazyConnect: true
});

app.get("/health", async (_request, reply) => {
  const checks = {
    api: "ok",
    postgres: "unknown",
    redis: "unknown"
  };

  try {
    await query("SELECT 1");
    checks.postgres = "ok";
  } catch (error) {
    app.log.error({ error }, "Postgres health check failed");
    checks.postgres = "error";
  }

  try {
    if (redis.status === "wait") {
      await redis.connect();
    }
    await redis.ping();
    checks.redis = "ok";
  } catch (error) {
    app.log.error({ error }, "Redis health check failed");
    checks.redis = "error";
  }

  const healthy = checks.postgres === "ok" && checks.redis === "ok";
  return reply.code(healthy ? 200 : 503).send({
    status: healthy ? "ok" : "degraded",
    checks
  });
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  await closeQueue();
  await redis.quit();
  await closeDb();
}

async function start(): Promise<void> {
  try {
    await app.register(refreshRoutes);
    await app.listen({ host: env.host, port: env.port });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

void start();
