import { getRefreshQueue } from "../queue/queue.js";
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

export type ScheduleRefreshResult = {
  eligibleStudyCount: number;
  candidateCount: number;
  insertedCount: number;
  skippedCount: number;
  enqueuedCount: number;
  jobs: RefreshJob[];
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
  filters: ScheduleFilters = {}
): Promise<ScheduleRefreshResult> {
  const eligibleCandidates = await findEligibleRefreshCandidates(filters);
  const insertedJobs: RefreshJob[] = [];

  for (const candidate of eligibleCandidates) {
    const scheduledAt = new Date(Date.now() + calculateSchedulingDelayMs());
    const job = await createPendingRefreshJob({
      patientId: candidate.patientId,
      studyId: candidate.studyId,
      endpoint: candidate.endpoint,
      priority: calculateRefreshPriority(candidate),
      scheduledAt
    });

    if (job !== null) {
      insertedJobs.push(job);
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
  }

  return {
    eligibleStudyCount: getUniqueStudyCount(eligibleCandidates),
    candidateCount: eligibleCandidates.length,
    insertedCount: insertedJobs.length,
    skippedCount: eligibleCandidates.length - insertedJobs.length,
    enqueuedCount: insertedJobs.length,
    jobs: insertedJobs
  };
}
