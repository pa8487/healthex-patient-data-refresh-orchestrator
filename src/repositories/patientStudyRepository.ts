import { query } from "../db/db.js";

export type ScheduleFilters = {
  patientIds?: string[];
  studyIds?: string[];
  endpoints?: string[];
};

export type EligibleRefreshCandidate = {
  patientId: string;
  studyId: string;
  endpoint: string;
  nextRefreshAt: Date;
  consentExpiresAt: Date | null;
  defaultPriority: number;
};

type EligibleRefreshCandidateRow = {
  patient_id: string;
  study_id: string;
  ehr_endpoint: string;
  next_refresh_at: Date;
  consent_expires_at: Date | null;
  default_priority: number;
};

export async function findEligibleRefreshCandidates(
  filters: ScheduleFilters = {},
  limit = 100
): Promise<EligibleRefreshCandidate[]> {
  const result = await query<EligibleRefreshCandidateRow>(
    `
      SELECT
        ps.patient_id,
        ps.study_id,
        pee.ehr_endpoint,
        ps.next_refresh_at,
        ps.consent_expires_at,
        s.default_priority
      FROM patient_studies ps
      JOIN studies s ON s.id = ps.study_id
      JOIN patient_ehr_endpoints pee ON pee.patient_id = ps.patient_id
      WHERE ps.next_refresh_at <= NOW()
        AND pee.is_active = TRUE
        AND ($2::UUID[] IS NULL OR ps.patient_id = ANY($2))
        AND ($3::UUID[] IS NULL OR ps.study_id = ANY($3))
        AND ($4::TEXT[] IS NULL OR pee.ehr_endpoint = ANY($4))
      ORDER BY ps.next_refresh_at ASC
      LIMIT $1
    `,
    [
      limit,
      filters.patientIds ?? null,
      filters.studyIds ?? null,
      filters.endpoints ?? null
    ]
  );

  return result.rows.map((row) => ({
    patientId: row.patient_id,
    studyId: row.study_id,
    endpoint: row.ehr_endpoint,
    nextRefreshAt: row.next_refresh_at,
    consentExpiresAt: row.consent_expires_at,
    defaultPriority: row.default_priority
  }));
}
