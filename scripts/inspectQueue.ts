import type { Job } from "bullmq";
import { closeDb, query } from "../src/db/db.js";
import {
  closeQueue,
  getRefreshQueue,
  type RefreshJobPayload
} from "../src/queue/queue.js";
import { toBullMqPriority } from "../src/queue/priority.js";

type RefreshJobRow = {
  id: string;
  patient_id: string;
  patient_name: string;
  study_id: string;
  study_name: string;
  endpoint: string;
  priority: number;
  status: string;
  scheduled_at: Date;
};

type QueueJobSnapshot = {
  bullJobId: string | undefined;
  refreshJobId: string;
  state: string;
  domainPriority: number | null;
  bullmqPriority: number | undefined;
  expectedBullmqPriority: number | null;
  dbStatus: string | null;
  patientName: string | null;
  studyName: string | null;
  endpoint: string | null;
  ready: boolean;
  enqueuedAt: string;
  readyAt: string;
};

function getReadyAt(job: Job<RefreshJobPayload>): Date {
  return new Date(job.timestamp + (job.delay ?? 0));
}

async function loadRefreshJobs(
  refreshJobIds: string[]
): Promise<Map<string, RefreshJobRow>> {
  if (refreshJobIds.length === 0) {
    return new Map();
  }

  const result = await query<RefreshJobRow>(
    `
      SELECT
        rj.id,
        rj.patient_id,
        p.name AS patient_name,
        rj.study_id,
        s.name AS study_name,
        rj.endpoint,
        rj.priority,
        rj.status,
        rj.scheduled_at
      FROM refresh_jobs rj
      JOIN patients p ON p.id = rj.patient_id
      JOIN studies s ON s.id = rj.study_id
      WHERE rj.id = ANY($1::UUID[])
    `,
    [refreshJobIds]
  );

  return new Map(result.rows.map((row) => [row.id, row]));
}

function sortQueueSnapshot(
  left: QueueJobSnapshot,
  right: QueueJobSnapshot
): number {
  // This mirrors the demo expectation, not BullMQ internals: ready jobs should
  // appear before delayed jobs, then lower BullMQ priority wins.
  if (left.ready !== right.ready) {
    return left.ready ? -1 : 1;
  }

  const leftPriority = left.bullmqPriority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.bullmqPriority ?? Number.MAX_SAFE_INTEGER;

  if (left.ready && leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  const leftReadyAt = Date.parse(left.readyAt);
  const rightReadyAt = Date.parse(right.readyAt);

  if (leftReadyAt !== rightReadyAt) {
    return leftReadyAt - rightReadyAt;
  }

  return Date.parse(left.enqueuedAt) - Date.parse(right.enqueuedAt);
}

async function inspectQueue(): Promise<void> {
  const queue = getRefreshQueue();
  const jobs = (await queue.getJobs(
    ["prioritized", "waiting", "delayed", "active"],
    0,
    100,
    true
  )) as Job<RefreshJobPayload>[];
  const refreshJobIds = Array.from(
    new Set(jobs.map((job) => job.data.refreshJobId))
  );
  const refreshJobsById = await loadRefreshJobs(refreshJobIds);

  const snapshot = await Promise.all(
    jobs.map(async (job): Promise<QueueJobSnapshot> => {
      const refreshJob = refreshJobsById.get(job.data.refreshJobId);
      const domainPriority = refreshJob?.priority ?? null;
      const readyAt = getReadyAt(job);

      return {
        bullJobId: job.id,
        refreshJobId: job.data.refreshJobId,
        state: await job.getState(),
        domainPriority,
        bullmqPriority: job.opts.priority,
        expectedBullmqPriority:
          domainPriority === null ? null : toBullMqPriority(domainPriority),
        dbStatus: refreshJob?.status ?? null,
        patientName: refreshJob?.patient_name ?? null,
        studyName: refreshJob?.study_name ?? null,
        endpoint: refreshJob?.endpoint ?? null,
        ready: readyAt.getTime() <= Date.now(),
        enqueuedAt: new Date(job.timestamp).toISOString(),
        readyAt: readyAt.toISOString()
      };
    })
  );

  snapshot.sort(sortQueueSnapshot);

  console.log(
    JSON.stringify(
      {
        event: "queue_priority_snapshot",
        queue: queue.name,
        note: "Ready jobs are sorted by BullMQ priority. BullMQ lower numeric priority is dequeued first; domain priority 3 maps to BullMQ priority 1.",
        count: snapshot.length,
        jobs: snapshot.map((job, index) => ({
          expectedOrder: index + 1,
          ...job
        }))
      },
      null,
      2
    )
  );
}

inspectQueue()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "queue_priority_snapshot_failed",
        error: error instanceof Error ? error.message : String(error)
      })
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueue();
    await closeDb();
  });
