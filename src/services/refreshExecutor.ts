import { getRefreshQueue } from "../queue/queue.js";
import {
  claimPendingRefreshJob,
  completeRefreshJob,
  failRefreshJob,
  scheduleRefreshJobRetry
} from "../repositories/refreshJobRepository.js";
import { refreshFromMockEhr } from "./mockEhrApi.js";
import {
  calculateRetryDelayMs,
  shouldRetryFailure
} from "./retryPolicy.js";

export type RefreshExecutionResult =
  | { status: "skipped"; reason: "not_claimable" }
  | { status: "completed"; refreshJobId: string }
  | {
      status: "retry_scheduled";
      refreshJobId: string;
      delayMs: number;
      scheduledAt: Date;
      errorType: string;
    }
  | {
      status: "failed";
      refreshJobId: string;
      errorType: string;
      errorMessage: string;
    };

export async function executeRefreshJob(
  refreshJobId: string,
  workerId: string
): Promise<RefreshExecutionResult> {
  const claimedJob = await claimPendingRefreshJob(refreshJobId, workerId);

  if (claimedJob === null) {
    return {
      status: "skipped",
      reason: "not_claimable"
    };
  }

  const result = await refreshFromMockEhr({
    patientId: claimedJob.patientId,
    studyId: claimedJob.studyId,
    endpoint: claimedJob.endpoint
  });

  if (result.success) {
    await completeRefreshJob(claimedJob);
    return {
      status: "completed",
      refreshJobId: claimedJob.id
    };
  }

  if (
    shouldRetryFailure(result.type, claimedJob.attempts, claimedJob.maxAttempts)
  ) {
    const delayMs = calculateRetryDelayMs(claimedJob.attempts);
    const scheduledAt = await scheduleRefreshJobRetry(
      claimedJob,
      delayMs,
      result.type,
      result.message
    );

    await getRefreshQueue().add(
      "refresh",
      { refreshJobId: claimedJob.id },
      {
        delay: delayMs,
        jobId: `${claimedJob.id}:attempt:${claimedJob.attempts + 1}`,
        priority: claimedJob.priority
      }
    );

    return {
      status: "retry_scheduled",
      refreshJobId: claimedJob.id,
      delayMs,
      scheduledAt,
      errorType: result.type
    };
  }

  await failRefreshJob(claimedJob, result.type, result.message);
  return {
    status: "failed",
    refreshJobId: claimedJob.id,
    errorType: result.type,
    errorMessage: result.message
  };
}
