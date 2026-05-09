import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env.js";

export const REFRESH_JOBS_QUEUE_NAME = "refresh-jobs";

export type RefreshJobPayload = {
  refreshJobId: string;
};

let queueConnection: IORedis | null = null;
let refreshQueue: Queue<RefreshJobPayload> | null = null;

function getQueueConnection(): IORedis {
  if (queueConnection === null) {
    queueConnection = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true
    });

    queueConnection.on("error", () => {
      // Health and queue operations report Redis availability explicitly.
    });
  }

  return queueConnection;
}

export function getRefreshQueue(): Queue<RefreshJobPayload> {
  if (refreshQueue === null) {
    refreshQueue = new Queue<RefreshJobPayload>(REFRESH_JOBS_QUEUE_NAME, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 500
      }
    });
  }

  return refreshQueue;
}

export async function closeQueue(): Promise<void> {
  if (refreshQueue !== null) {
    await refreshQueue.close();
    refreshQueue = null;
  }

  if (queueConnection !== null) {
    await queueConnection.quit();
    queueConnection = null;
  }
}
