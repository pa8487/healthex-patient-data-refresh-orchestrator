import { query } from "../db/db.js";

export type EligiblePatientStudy = {
  patientId: string;
  studyId: string;
  endpoint: string;
  nextRefreshAt: Date;
  consentExpiresAt: Date | null;
  defaultPriority: number;
};

type EligiblePatientStudyRow = {
  patient_id: string;
  study_id: string;
  ehr_endpoint: string;
  next_refresh_at: Date;
  consent_expires_at: Date | null;
  default_priority: number;
};

export async function findEligiblePatientStudies(
  limit = 100
): Promise<EligiblePatientStudy[]> {
  const result = await query<EligiblePatientStudyRow>(
    `
      SELECT
        ps.patient_id,
        ps.study_id,
        ps.ehr_endpoint,
        ps.next_refresh_at,
        ps.consent_expires_at,
        s.default_priority
      FROM patient_studies ps
      JOIN studies s ON s.id = ps.study_id
      WHERE ps.next_refresh_at <= NOW()
      ORDER BY ps.next_refresh_at ASC
      LIMIT $1
    `,
    [limit]
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
