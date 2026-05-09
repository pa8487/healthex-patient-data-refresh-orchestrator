import type { EligibleRefreshCandidate } from "../repositories/patientStudyRepository.js";

const CONSENT_NEAR_EXPIRY_MS = 72 * 60 * 60 * 1000;
const MAX_PRIORITY = 3;

export function calculateRefreshPriority(
  candidate: EligibleRefreshCandidate
): number {
  const basePriority = candidate.defaultPriority;

  if (candidate.consentExpiresAt === null) {
    return basePriority;
  }

  const expiresInMs = candidate.consentExpiresAt.getTime() - Date.now();
  const consentIsNearExpiry =
    expiresInMs >= 0 && expiresInMs <= CONSENT_NEAR_EXPIRY_MS;

  if (!consentIsNearExpiry) {
    return basePriority;
  }

  return Math.min(basePriority + 1, MAX_PRIORITY);
}
