import { query } from "../db/db.js";

export type CreateRefreshJobInput = {
  patientId: string;
  studyId: string;
  endpoint: string;
  priority: number;
};

export type RefreshJob = {
  id: string;
  patientId: string;
  studyId: string;
  endpoint: string;
  priority: number;
  status: "pending" | "claimed" | "completed" | "failed";
  scheduledAt: Date;
};

type RefreshJobRow = {
  id: string;
  patient_id: string;
  study_id: string;
  endpoint: string;
  priority: number;
  status: RefreshJob["status"];
  scheduled_at: Date;
};

export async function createPendingRefreshJob(
  input: CreateRefreshJobInput
): Promise<RefreshJob | null> {
  const result = await query<RefreshJobRow>(
    `
      INSERT INTO refresh_jobs (
        patient_id,
        study_id,
        endpoint,
        priority,
        status,
        scheduled_at
      )
      VALUES ($1, $2, $3, $4, 'pending', NOW())
      ON CONFLICT (patient_id, study_id)
        WHERE status IN ('pending', 'claimed')
        DO NOTHING
      RETURNING
        id,
        patient_id,
        study_id,
        endpoint,
        priority,
        status,
        scheduled_at
    `,
    [input.patientId, input.studyId, input.endpoint, input.priority]
  );

  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }

  return {
    id: row.id,
    patientId: row.patient_id,
    studyId: row.study_id,
    endpoint: row.endpoint,
    priority: row.priority,
    status: row.status,
    scheduledAt: row.scheduled_at
  };
}
