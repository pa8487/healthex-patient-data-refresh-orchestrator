import type { MockEhrFailureType } from "./mockEhrApi.js";

const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 3_600_000;

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
  return Math.min(
    BASE_RETRY_DELAY_MS * 2 ** Math.max(attempts - 1, 0),
    MAX_RETRY_DELAY_MS
  );
}
