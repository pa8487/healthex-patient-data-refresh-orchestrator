import type { FastifyPluginAsync } from "fastify";
import { REFRESH_JOBS_QUEUE_NAME } from "../queue/queue.js";
import { scheduleEligibleRefreshJobs } from "../scheduler/scheduler.js";

export const refreshRoutes: FastifyPluginAsync = async (app) => {
  app.post("/schedule", async (_request, reply) => {
    const result = await scheduleEligibleRefreshJobs();

    app.log.info(
      {
        eligible: result.eligibleCount,
        inserted: result.insertedCount,
        skipped: result.skippedCount,
        enqueued: result.enqueuedCount
      },
      "Scheduling pass completed"
    );

    return reply.code(202).send({
      status: "scheduled",
      queue: REFRESH_JOBS_QUEUE_NAME,
      eligible: result.eligibleCount,
      inserted: result.insertedCount,
      skipped: result.skippedCount,
      enqueued: result.enqueuedCount,
      jobIds: result.jobs.map((job) => job.id)
    });
  });
};
