export const env = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://healthex:healthex@localhost:55432/healthex",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  pgPoolMax: Number(process.env.PG_POOL_MAX ?? 10)
};
