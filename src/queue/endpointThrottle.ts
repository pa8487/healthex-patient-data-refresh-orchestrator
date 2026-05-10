import { getQueueConnection } from "./queue.js";

const WINDOW_SECONDS = 60;
const FALLBACK_RETRY_AFTER_MS = 5_000;

type EndpointFamily = "epic" | "cerner" | "regional" | "unknown";

export type EndpointThrottleResult =
  | {
      allowed: true;
      endpointFamily: EndpointFamily;
      limit: number;
    }
  | {
      allowed: false;
      endpointFamily: EndpointFamily;
      limit: number;
      retryAfterMs: number;
    };

function getEndpointFamily(endpoint: string): EndpointFamily {
  const normalized = endpoint.toLowerCase();

  if (normalized.includes("epic")) {
    return "epic";
  }

  if (normalized.includes("cerner")) {
    return "cerner";
  }

  if (normalized.includes("regional")) {
    return "regional";
  }

  return "unknown";
}

function getEndpointLimit(endpointFamily: EndpointFamily): number {
  if (endpointFamily === "epic") {
    return 100;
  }

  return 30;
}

export async function checkEndpointThrottle(
  endpoint: string
): Promise<EndpointThrottleResult> {
  const endpointFamily = getEndpointFamily(endpoint);
  const limit = getEndpointLimit(endpointFamily);
  const key = `endpoint-throttle:${endpoint.toLowerCase()}`;
  const redis = getQueueConnection();

  // Fixed-window throttling is intentionally small for the exercise. The
  // production version would use a token bucket and endpoint health signals.
  const requestCount = await redis.incr(key);

  if (requestCount === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }

  if (requestCount <= limit) {
    return {
      allowed: true,
      endpointFamily,
      limit
    };
  }

  const ttlSeconds = await redis.ttl(key);
  const retryAfterMs =
    ttlSeconds > 0 ? ttlSeconds * 1_000 : FALLBACK_RETRY_AFTER_MS;

  return {
    allowed: false,
    endpointFamily,
    limit,
    retryAfterMs
  };
}
