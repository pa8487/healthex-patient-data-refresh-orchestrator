import { Worker, type Job } from "bullmq";
import { env } from "../config/env.js";
import { closeDb } from "../db/db.js";
import {
  getQueueConnection,
  REFRESH_JOBS_QUEUE_NAME,
  type RefreshJobPayload
} from "../queue/queue.js";
import { executeRefreshJob } from "../services/refreshExecutor.js";

export function createRefreshWorker(): Worker<RefreshJobPayload> {
  const worker = new Worker<RefreshJobPayload>(
    REFRESH_JOBS_QUEUE_NAME,
    async (job: Job<RefreshJobPayload>) => {
      const result = await executeRefreshJob(
        job.data.refreshJobId,
        env.workerId
      );

      console.log(
        JSON.stringify({
          event: "refresh_job_processed",
          bullJobId: job.id,
          refreshJobId: job.data.refreshJobId,
          result
        })
      );

      return result;
    },
    {
      connection: getQueueConnection(),
      concurrency: env.workerConcurrency
    }
  );

  worker.on("failed", (job, error) => {
    console.error(
      JSON.stringify({
        event: "refresh_worker_failed",
        bullJobId: job?.id,
        refreshJobId: job?.data.refreshJobId,
        error: error.message
      })
    );
  });

  worker.on("error", (error) => {
    console.error(
      JSON.stringify({
        event: "refresh_worker_error",
        error: error.message
      })
    );
  });

  return worker;
}

const worker = createRefreshWorker();

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(JSON.stringify({ event: "refresh_worker_shutdown", signal }));
  await worker.close();
  await getQueueConnection().quit();
  await closeDb();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
