import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isLogLevel, type LogLevel } from "../logging/logger.js";

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

function readPositiveInteger(name: string, defaultValue: number): number {
  const rawValue = process.env[name];

  if (rawValue === undefined) {
    return defaultValue;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsedValue;
}

function readLogLevel(): LogLevel {
  const logLevel = process.env.LOG_LEVEL ?? "info";

  if (!isLogLevel(logLevel)) {
    throw new Error("LOG_LEVEL must be one of debug, info, warn, or error");
  }

  return logLevel;
}

export const env = {
  host: process.env.HOST ?? "0.0.0.0",
  port: readPositiveInteger("PORT", 3000),
  logLevel: readLogLevel(),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://healthex:healthex@localhost:55432/healthex",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  pgPoolMax: readPositiveInteger("PG_POOL_MAX", 10),
  workerConcurrency: readPositiveInteger("WORKER_CONCURRENCY", 4),
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`
};
