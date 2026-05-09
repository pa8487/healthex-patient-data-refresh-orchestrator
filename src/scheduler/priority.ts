import type { EligiblePatientStudy } from "../repositories/patientStudyRepository.js";

const CONSENT_NEAR_EXPIRY_MS = 72 * 60 * 60 * 1000;
const MAX_PRIORITY = 3;

export function calculateRefreshPriority(patientStudy: EligiblePatientStudy): number {
  const basePriority = patientStudy.defaultPriority;

  if (patientStudy.consentExpiresAt === null) {
    return basePriority;
  }

  const expiresInMs = patientStudy.consentExpiresAt.getTime() - Date.now();
  const consentIsNearExpiry =
    expiresInMs >= 0 && expiresInMs <= CONSENT_NEAR_EXPIRY_MS;

  if (!consentIsNearExpiry) {
    return basePriority;
  }

  return Math.min(basePriority + 1, MAX_PRIORITY);
}
