import type { MockEhrFailureType } from "./mockEhrApi.js";

const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 3_600_000;
const JITTER_RATIO = 0.2;

export function isRetryableFailure(type: MockEhrFailureType): boolean {
  return type === "TRANSIENT" || type === "RATE_LIMIT";
}

export function shouldRetryFailure(
  type: MockEhrFailureType,
  attempts: number,
  maxAttempts: number
): boolean {
  return isRetryableFailure(type) && attempts < maxAttempts;
}

export function calculateRetryDelayMs(attempts: number): number {
  const baseDelayMs = Math.min(
    BASE_RETRY_DELAY_MS * 2 ** Math.max(attempts - 1, 0),
    MAX_RETRY_DELAY_MS
  );
  const jitterMs = Math.floor(baseDelayMs * JITTER_RATIO * Math.random());

  return Math.min(baseDelayMs + jitterMs, MAX_RETRY_DELAY_MS);
}
