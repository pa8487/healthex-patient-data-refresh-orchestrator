import { getRefreshQueue } from "../queue/queue.js";
import { checkEndpointThrottle } from "../queue/endpointThrottle.js";
import { toBullMqPriority } from "../queue/priority.js";
import {
  createConsoleLogger,
  type StructuredLogger
} from "../logging/logger.js";
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

const defaultLogger = createConsoleLogger("refresh-executor");

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

export type RefreshExecutionOptions = {
  bullJobId?: string;
  logger?: StructuredLogger;
};

async function scheduleRetry(
  job: ClaimedRefreshJob,
  delayMs: number,
  errorType: "TRANSIENT" | "RATE_LIMIT",
  errorMessage: string,
  options: Required<Pick<RefreshExecutionOptions, "logger">> &
    Pick<RefreshExecutionOptions, "bullJobId">
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
      priority: toBullMqPriority(job.priority)
    }
  );

  options.logger.info(
    {
      event: "refresh_retry_scheduled",
      bullJobId: options.bullJobId,
      refreshJobId: job.id,
      patientId: job.patientId,
      studyId: job.studyId,
      endpoint: job.endpoint,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      priority: job.priority,
      bullmqPriority: toBullMqPriority(job.priority),
      delayMs,
      scheduledAt: scheduledAt.toISOString(),
      errorType,
      errorMessage
    },
    "Refresh job retry scheduled"
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
  workerId: string,
  options: RefreshExecutionOptions = {}
): Promise<RefreshExecutionResult> {
  const logger = options.logger ?? defaultLogger;

  logger.info(
    {
      event: "refresh_claim_attempt",
      bullJobId: options.bullJobId,
      refreshJobId,
      workerId
    },
    "Attempting to claim refresh job"
  );

  const claimedJob = await claimPendingRefreshJob(refreshJobId, workerId);

  if (claimedJob === null) {
    logger.warn(
      {
        event: "refresh_claim_skipped",
        bullJobId: options.bullJobId,
        refreshJobId,
        workerId
      },
      "Refresh job was not claimable"
    );

    return {
      status: "skipped",
      reason: "not_claimable"
    };
  }

  logger.info(
    {
      event: "refresh_job_claimed",
      bullJobId: options.bullJobId,
      refreshJobId: claimedJob.id,
      patientId: claimedJob.patientId,
      studyId: claimedJob.studyId,
      endpoint: claimedJob.endpoint,
      attempt: claimedJob.attempts,
      maxAttempts: claimedJob.maxAttempts,
      priority: claimedJob.priority,
      workerId
    },
    "Refresh job claimed"
  );

  const throttle = await checkEndpointThrottle(claimedJob.endpoint);

  if (!throttle.allowed) {
    logger.warn(
      {
        event: "refresh_endpoint_throttled",
        bullJobId: options.bullJobId,
        refreshJobId: claimedJob.id,
        endpoint: claimedJob.endpoint,
        endpointFamily: throttle.endpointFamily,
        limit: throttle.limit,
        retryAfterMs: throttle.retryAfterMs
      },
      "Endpoint throttle delayed refresh job"
    );

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
        `Endpoint throttle delayed ${claimedJob.endpoint}`,
        { logger, bullJobId: options.bullJobId }
      );
    }

    await failRefreshJob(
      claimedJob,
      "RATE_LIMIT",
      `Endpoint throttle exceeded retry budget for ${claimedJob.endpoint}`
    );
    logger.warn(
      {
        event: "refresh_job_failed",
        bullJobId: options.bullJobId,
        refreshJobId: claimedJob.id,
        patientId: claimedJob.patientId,
        studyId: claimedJob.studyId,
        endpoint: claimedJob.endpoint,
        attempt: claimedJob.attempts,
        maxAttempts: claimedJob.maxAttempts,
        errorType: "RATE_LIMIT",
        errorMessage: `Endpoint throttle exceeded retry budget for ${claimedJob.endpoint}`
      },
      "Refresh job failed"
    );
    return {
      status: "failed",
      refreshJobId: claimedJob.id,
      errorType: "RATE_LIMIT",
      errorMessage: `Endpoint throttle exceeded retry budget for ${claimedJob.endpoint}`
    };
  }

  logger.debug(
    {
      event: "refresh_endpoint_throttle_allowed",
      bullJobId: options.bullJobId,
      refreshJobId: claimedJob.id,
      endpoint: claimedJob.endpoint,
      endpointFamily: throttle.endpointFamily,
      limit: throttle.limit
    },
    "Endpoint throttle allowed refresh job"
  );

  logger.info(
    {
      event: "mock_ehr_refresh_started",
      bullJobId: options.bullJobId,
      refreshJobId: claimedJob.id,
      patientId: claimedJob.patientId,
      studyId: claimedJob.studyId,
      endpoint: claimedJob.endpoint,
      attempt: claimedJob.attempts
    },
    "Mock EHR refresh started"
  );

  const result = await refreshFromMockEhr({
    patientId: claimedJob.patientId,
    studyId: claimedJob.studyId,
    endpoint: claimedJob.endpoint,
    attempt: claimedJob.attempts
  });

  if (result.success) {
    await completeRefreshJob(claimedJob);
    logger.info(
      {
        event: "refresh_job_completed",
        bullJobId: options.bullJobId,
        refreshJobId: claimedJob.id,
        patientId: claimedJob.patientId,
        studyId: claimedJob.studyId,
        endpoint: claimedJob.endpoint,
        attempt: claimedJob.attempts
      },
      "Refresh job completed"
    );
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
      result.message,
      { logger, bullJobId: options.bullJobId }
    );
  }

  await failRefreshJob(claimedJob, result.type, result.message);
  logger.warn(
    {
      event: "refresh_job_failed",
      bullJobId: options.bullJobId,
      refreshJobId: claimedJob.id,
      patientId: claimedJob.patientId,
      studyId: claimedJob.studyId,
      endpoint: claimedJob.endpoint,
      attempt: claimedJob.attempts,
      maxAttempts: claimedJob.maxAttempts,
      errorType: result.type,
      errorMessage: result.message
    },
    "Refresh job failed"
  );
  return {
    status: "failed",
    refreshJobId: claimedJob.id,
    errorType: result.type,
    errorMessage: result.message
  };
}
