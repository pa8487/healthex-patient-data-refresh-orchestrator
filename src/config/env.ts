import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnvFile(filePath = resolve(process.cwd(), ".env")): void {
  if (!existsSync(filePath)) {
    return;
  }

  const entries = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const entry of entries) {
    const trimmed = entry.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadDotEnvFile();

export const env = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? "info",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://healthex:healthex@localhost:55432/healthex",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  pgPoolMax: Number(process.env.PG_POOL_MAX ?? 10),
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`
};
