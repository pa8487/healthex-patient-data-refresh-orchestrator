import { getRefreshQueue } from "../queue/queue.js";
import {
  createConsoleLogger,
  type StructuredLogger
} from "../logging/logger.js";
import {
  findEligibleRefreshCandidates,
  type ScheduleFilters
} from "../repositories/patientStudyRepository.js";
import {
  createPendingRefreshJob,
  type RefreshJob
} from "../repositories/refreshJobRepository.js";
import { calculateRefreshPriority } from "./priority.js";

const MAX_SCHEDULING_JITTER_MS = 10_000;
const defaultLogger = createConsoleLogger("scheduler");

export type ScheduleRefreshResult = {
  eligibleStudyCount: number;
  candidateCount: number;
  insertedCount: number;
  skippedCount: number;
  enqueuedCount: number;
  jobs: RefreshJob[];
};

export type ScheduleRefreshOptions = {
  logger?: StructuredLogger;
  requestId?: string;
};

function calculateSchedulingDelayMs(): number {
  return Math.floor(Math.random() * (MAX_SCHEDULING_JITTER_MS + 1));
}

function getUniqueStudyCount(
  candidates: Array<{ patientId: string; studyId: string }>
): number {
  return new Set(
    candidates.map((candidate) => `${candidate.patientId}:${candidate.studyId}`)
  ).size;
}

export async function scheduleEligibleRefreshJobs(
  filters: ScheduleFilters = {},
  options: ScheduleRefreshOptions = {}
): Promise<ScheduleRefreshResult> {
  const logger = options.logger ?? defaultLogger;

  logger.info(
    {
      event: "schedule_started",
      requestId: options.requestId,
      filters
    },
    "Scheduling pass started"
  );

  const eligibleCandidates = await findEligibleRefreshCandidates(filters);
  const eligibleStudyCount = getUniqueStudyCount(eligibleCandidates);
  const insertedJobs: RefreshJob[] = [];

  logger.info(
    {
      event: "schedule_candidates_found",
      requestId: options.requestId,
      eligibleStudies: eligibleStudyCount,
      candidates: eligibleCandidates.length,
      filters
    },
    "Eligible refresh candidates found"
  );

  for (const candidate of eligibleCandidates) {
    const priority = calculateRefreshPriority(candidate);
    const scheduledAt = new Date(Date.now() + calculateSchedulingDelayMs());
    const job = await createPendingRefreshJob({
      patientId: candidate.patientId,
      studyId: candidate.studyId,
      endpoint: candidate.endpoint,
      priority,
      scheduledAt
    });

    if (job !== null) {
      insertedJobs.push(job);
      logger.debug(
        {
          event: "schedule_job_inserted",
          requestId: options.requestId,
          refreshJobId: job.id,
          patientId: job.patientId,
          studyId: job.studyId,
          endpoint: job.endpoint,
          priority: job.priority,
          scheduledAt: job.scheduledAt.toISOString()
        },
        "Refresh job inserted"
      );
    } else {
      logger.debug(
        {
          event: "schedule_job_skipped_duplicate",
          requestId: options.requestId,
          patientId: candidate.patientId,
          studyId: candidate.studyId,
          endpoint: candidate.endpoint,
          priority
        },
        "Active duplicate refresh job skipped"
      );
    }
  }

  if (insertedJobs.length > 0) {
    const queue = getRefreshQueue();

    await queue.addBulk(
      insertedJobs.map((job) => ({
        name: "refresh",
        data: {
          refreshJobId: job.id
        },
        opts: {
          jobId: job.id,
          delay: Math.max(job.scheduledAt.getTime() - Date.now(), 0),
          priority: job.priority
        }
      }))
    );

    logger.info(
      {
        event: "schedule_jobs_enqueued",
        requestId: options.requestId,
        enqueued: insertedJobs.length,
        queue: queue.name
      },
      "Refresh jobs enqueued"
    );
  }

  const result = {
    eligibleStudyCount,
    candidateCount: eligibleCandidates.length,
    insertedCount: insertedJobs.length,
    skippedCount: eligibleCandidates.length - insertedJobs.length,
    enqueuedCount: insertedJobs.length,
    jobs: insertedJobs
  };

  logger.info(
    {
      event: "schedule_completed",
      requestId: options.requestId,
      eligibleStudies: result.eligibleStudyCount,
      candidates: result.candidateCount,
      inserted: result.insertedCount,
      skipped: result.skippedCount,
      enqueued: result.enqueuedCount
    },
    "Scheduling pass completed"
  );

  return result;
}
