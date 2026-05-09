import { getRefreshQueue } from "../queue/queue.js";
import { findEligiblePatientStudies } from "../repositories/patientStudyRepository.js";
import {
  createPendingRefreshJob,
  type RefreshJob
} from "../repositories/refreshJobRepository.js";
import { calculateRefreshPriority } from "./priority.js";

export type ScheduleRefreshResult = {
  eligibleCount: number;
  insertedCount: number;
  skippedCount: number;
  enqueuedCount: number;
  jobs: RefreshJob[];
};

export async function scheduleEligibleRefreshJobs(): Promise<ScheduleRefreshResult> {
  const eligiblePatientStudies = await findEligiblePatientStudies();
  const insertedJobs: RefreshJob[] = [];

  for (const patientStudy of eligiblePatientStudies) {
    const job = await createPendingRefreshJob({
      patientId: patientStudy.patientId,
      studyId: patientStudy.studyId,
      endpoint: patientStudy.endpoint,
      priority: calculateRefreshPriority(patientStudy)
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
          priority: job.priority
        }
      }))
    );
  }

  return {
    eligibleCount: eligiblePatientStudies.length,
    insertedCount: insertedJobs.length,
    skippedCount: eligiblePatientStudies.length - insertedJobs.length,
    enqueuedCount: insertedJobs.length,
    jobs: insertedJobs
  };
}
