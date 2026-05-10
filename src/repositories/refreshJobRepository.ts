import { query, withTransaction } from "../db/db.js";

export type CreateRefreshJobInput = {
  patientId: string;
  studyId: string;
  endpoint: string;
  priority: number;
  scheduledAt: Date;
};

export type RefreshJob = {
  id: string;
  patientId: string;
  studyId: string;
  endpoint: string;
  priority: number;
  status: "pending" | "claimed" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date;
};

type RefreshJobRow = {
  id: string;
  patient_id: string;
  study_id: string;
  endpoint: string;
  priority: number;
  status: RefreshJob["status"];
  attempts: number;
  max_attempts: number;
  scheduled_at: Date;
};

export type ClaimedRefreshJob = RefreshJob & {
  status: "claimed";
};

function mapRefreshJob(row: RefreshJobRow): RefreshJob {
  return {
    id: row.id,
    patientId: row.patient_id,
    studyId: row.study_id,
    endpoint: row.endpoint,
    priority: row.priority,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledAt: row.scheduled_at
  };
}

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
      VALUES ($1, $2, $3, $4, 'pending', $5)
      -- The partial unique index is the idempotency boundary for
      -- concurrent schedulers; duplicates return no row instead of erroring.
      ON CONFLICT (patient_id, study_id, endpoint)
        WHERE status IN ('pending', 'claimed')
        DO NOTHING
      RETURNING
        id,
        patient_id,
        study_id,
        endpoint,
        priority,
        status,
        attempts,
        max_attempts,
        scheduled_at
    `,
    [
      input.patientId,
      input.studyId,
      input.endpoint,
      input.priority,
      input.scheduledAt
    ]
  );

  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }

  return mapRefreshJob(row);
}

export async function claimPendingRefreshJob(
  refreshJobId: string,
  workerId: string
): Promise<ClaimedRefreshJob | null> {
  const result = await query<RefreshJobRow>(
    `
      -- This update is the worker lock. If it returns no row, the BullMQ
      -- delivery is stale, duplicated, or not due yet, so the worker skips it.
      UPDATE refresh_jobs
      SET status = 'claimed',
          claimed_at = NOW(),
          worker_id = $2,
          attempts = attempts + 1,
          error_type = NULL,
          error_message = NULL
      WHERE id = $1
        AND status = 'pending'
        AND scheduled_at <= NOW()
      RETURNING
        id,
        patient_id,
        study_id,
        endpoint,
        priority,
        status,
        attempts,
        max_attempts,
        scheduled_at
    `,
    [refreshJobId, workerId]
  );

  const row = result.rows[0];
  if (row === undefined || row.status !== "claimed") {
    return null;
  }

  return {
    ...mapRefreshJob(row),
    status: "claimed"
  };
}

export async function completeRefreshJob(job: ClaimedRefreshJob): Promise<void> {
  await withTransaction(async (client) => {
    // Completion and schedule advancement must commit together so a successful
    // refresh cannot leave the enrollment immediately due again.
    const completedJob = await client.query(
      `
        UPDATE refresh_jobs
        SET status = 'completed',
            completed_at = NOW(),
            error_type = NULL,
            error_message = NULL
        WHERE id = $1
          AND status = 'claimed'
        RETURNING id
      `,
      [job.id]
    );

    if (completedJob.rowCount !== 1) {
      throw new Error(`Refresh job ${job.id} was not claimable for completion`);
    }

    await client.query(
      `
        UPDATE patient_studies ps
        SET last_refresh_at = NOW(),
            next_refresh_at = NOW() + (s.refresh_frequency_minutes * INTERVAL '1 minute')
        FROM studies s
        WHERE ps.patient_id = $1
          AND ps.study_id = $2
          AND s.id = ps.study_id
      `,
      [job.patientId, job.studyId]
    );
  });
}

export async function scheduleRefreshJobRetry(
  job: ClaimedRefreshJob,
  delayMs: number,
  errorType: string,
  errorMessage: string
): Promise<Date> {
  const result = await query<{ scheduled_at: Date }>(
    `
      -- Retries reuse the lifecycle row for MVP simplicity. A production audit
      -- trail would add an append-only refresh_job_attempts table.
      UPDATE refresh_jobs
      SET status = 'pending',
          scheduled_at = NOW() + ($2::INT * INTERVAL '1 millisecond'),
          claimed_at = NULL,
          worker_id = NULL,
          error_type = $3,
          error_message = $4
      WHERE id = $1
        AND status = 'claimed'
      RETURNING scheduled_at
    `,
    [job.id, delayMs, errorType, errorMessage]
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Refresh job ${job.id} was not claimable for retry`);
  }

  return row.scheduled_at;
}

export async function markPendingRefreshJobsFailed(
  refreshJobIds: string[],
  errorType: string,
  errorMessage: string
): Promise<void> {
  if (refreshJobIds.length === 0) {
    return;
  }

  await query(
    `
      UPDATE refresh_jobs
      SET status = 'failed',
          completed_at = NOW(),
          error_type = $2,
          error_message = $3
      WHERE id = ANY($1::UUID[])
        AND status = 'pending'
    `,
    [refreshJobIds, errorType, errorMessage]
  );
}

export async function failRefreshJob(
  job: ClaimedRefreshJob,
  errorType: string,
  errorMessage: string
): Promise<void> {
  const result = await query(
    `
      UPDATE refresh_jobs
      SET status = 'failed',
          completed_at = NOW(),
          error_type = $2,
          error_message = $3
      WHERE id = $1
        AND status = 'claimed'
    `,
    [job.id, errorType, errorMessage]
  );

  if (result.rowCount !== 1) {
    throw new Error(`Refresh job ${job.id} was not claimable for failure`);
  }
}
