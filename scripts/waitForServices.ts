import Redis from "ioredis";
import { env } from "../src/config/env.js";
import { closeDb, query } from "../src/db/db.js";

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(
  service: string,
  check: () => Promise<void>
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await check();
      console.log(
        JSON.stringify({
          event: "service_ready",
          service,
          attempt
        })
      );
      return;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        throw error;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function waitForPostgres(): Promise<void> {
  await waitFor("postgres", async () => {
    await query("SELECT 1");
  });
}

async function waitForRedis(): Promise<void> {
  const redis = new Redis(env.redisUrl, {
    maxRetriesPerRequest: 1,
    lazyConnect: true
  });

  try {
    await waitFor("redis", async () => {
      if (redis.status === "wait") {
        await redis.connect();
      }

      await redis.ping();
    });
  } finally {
    await redis.quit();
  }
}

async function waitForServices(): Promise<void> {
  await waitForPostgres();
  await waitForRedis();
}

waitForServices()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "services_not_ready",
        error: error instanceof Error ? error.message : String(error)
      })
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
