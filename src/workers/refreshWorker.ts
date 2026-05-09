import { Worker, type Job } from "bullmq";
import { env } from "../config/env.js";
import { closeDb } from "../db/db.js";
import { createConsoleLogger } from "../logging/logger.js";
import {
  getQueueConnection,
  REFRESH_JOBS_QUEUE_NAME,
  type RefreshJobPayload
} from "../queue/queue.js";
import { executeRefreshJob } from "../services/refreshExecutor.js";

const logger = createConsoleLogger("refresh-worker");

export function createRefreshWorker(): Worker<RefreshJobPayload> {
  logger.info(
    {
      event: "refresh_worker_starting",
      queue: REFRESH_JOBS_QUEUE_NAME,
      workerId: env.workerId,
      concurrency: env.workerConcurrency
    },
    "Starting refresh worker"
  );

  const worker = new Worker<RefreshJobPayload>(
    REFRESH_JOBS_QUEUE_NAME,
    async (job: Job<RefreshJobPayload>) => {
      const result = await executeRefreshJob(
        job.data.refreshJobId,
        env.workerId,
        {
          bullJobId: String(job.id),
          logger
        }
      );

      logger.info(
        {
          event: "refresh_job_processed",
          bullJobId: job.id,
          refreshJobId: job.data.refreshJobId,
          result
        },
        "Refresh job processed"
      );

      return result;
    },
    {
      connection: getQueueConnection(),
      concurrency: env.workerConcurrency
    }
  );

  worker.on("ready", () => {
    logger.info(
      {
        event: "refresh_worker_ready",
        queue: REFRESH_JOBS_QUEUE_NAME,
        workerId: env.workerId,
        concurrency: env.workerConcurrency
      },
      "Refresh worker ready"
    );
  });

  worker.on("active", (job) => {
    logger.info(
      {
        event: "refresh_job_dequeued",
        bullJobId: job.id,
        refreshJobId: job.data.refreshJobId,
        workerId: env.workerId
      },
      "Refresh job dequeued"
    );
  });

  worker.on("completed", (job, result) => {
    logger.info(
      {
        event: "refresh_worker_job_completed",
        bullJobId: job.id,
        refreshJobId: job.data.refreshJobId,
        result
      },
      "BullMQ job completed"
    );
  });

  worker.on("failed", (job, error) => {
    logger.error(
      {
        event: "refresh_worker_failed",
        bullJobId: job?.id,
        refreshJobId: job?.data.refreshJobId,
        error: error.message
      },
      "BullMQ job failed"
    );
  });

  worker.on("error", (error) => {
    logger.error(
      {
        event: "refresh_worker_error",
        error: error.message
      },
      "Refresh worker error"
    );
  });

  return worker;
}

const worker = createRefreshWorker();

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info(
    { event: "refresh_worker_shutdown", signal },
    "Stopping refresh worker"
  );
  await worker.close();
  await getQueueConnection().quit();
  await closeDb();
  logger.info({ event: "refresh_worker_stopped", signal }, "Refresh worker stopped");
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
