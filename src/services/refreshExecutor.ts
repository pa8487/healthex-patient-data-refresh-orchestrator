import { getRefreshQueue } from "../queue/queue.js";
import { checkEndpointThrottle } from "../queue/endpointThrottle.js";
import {
  type ClaimedRefreshJob,
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

async function scheduleRetry(
  job: ClaimedRefreshJob,
  delayMs: number,
  errorType: "TRANSIENT" | "RATE_LIMIT",
  errorMessage: string
): Promise<Extract<RefreshExecutionResult, { status: "retry_scheduled" }>> {
  const scheduledAt = await scheduleRefreshJobRetry(
    job,
    delayMs,
    errorType,
    errorMessage
  );

  await getRefreshQueue().add(
    "refresh",
    { refreshJobId: job.id },
    {
      delay: delayMs,
      jobId: `${job.id}:attempt:${job.attempts + 1}`,
      priority: job.priority
    }
  );

  return {
    status: "retry_scheduled",
    refreshJobId: job.id,
    delayMs,
    scheduledAt,
    errorType
  };
}

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

  const throttle = await checkEndpointThrottle(claimedJob.endpoint);

  if (!throttle.allowed) {
    if (
      shouldRetryFailure(
        "RATE_LIMIT",
        claimedJob.attempts,
        claimedJob.maxAttempts
      )
    ) {
      return scheduleRetry(
        claimedJob,
        throttle.retryAfterMs,
        "RATE_LIMIT",
        `Endpoint throttle delayed ${claimedJob.endpoint}`
      );
    }

    await failRefreshJob(
      claimedJob,
      "RATE_LIMIT",
      `Endpoint throttle exceeded retry budget for ${claimedJob.endpoint}`
    );
    return {
      status: "failed",
      refreshJobId: claimedJob.id,
      errorType: "RATE_LIMIT",
      errorMessage: `Endpoint throttle exceeded retry budget for ${claimedJob.endpoint}`
    };
  }

  const result = await refreshFromMockEhr({
    patientId: claimedJob.patientId,
    studyId: claimedJob.studyId,
    endpoint: claimedJob.endpoint,
    attempt: claimedJob.attempts
  });

  if (result.success) {
    await completeRefreshJob(claimedJob);
    return {
      status: "completed",
      refreshJobId: claimedJob.id
    };
  }

  if (
    result.type !== "PERMANENT" &&
    shouldRetryFailure(result.type, claimedJob.attempts, claimedJob.maxAttempts)
  ) {
    const delayMs = calculateRetryDelayMs(claimedJob.attempts);
    return scheduleRetry(
      claimedJob,
      delayMs,
      result.type,
      result.message
    );
  }

  await failRefreshJob(claimedJob, result.type, result.message);
  return {
    status: "failed",
    refreshJobId: claimedJob.id,
    errorType: result.type,
    errorMessage: result.message
  };
}
