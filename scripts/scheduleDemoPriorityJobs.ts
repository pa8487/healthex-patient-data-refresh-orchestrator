import { closeDb } from "../src/db/db.js";
import { createConsoleLogger } from "../src/logging/logger.js";
import { closeQueue } from "../src/queue/queue.js";
import { scheduleEligibleRefreshJobs } from "../src/scheduler/scheduler.js";

const logger = createConsoleLogger("demo-scheduler");

const demoFilters = {
  patientIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
  studyIds: ["11111111-1111-4111-8111-111111111111"]
};

async function scheduleDemoPriorityJobs(): Promise<void> {
  const result = await scheduleEligibleRefreshJobs(demoFilters, {
    logger,
    requestId: "bootstrap-demo-priority-2"
  });

  logger.info(
    {
      event: "demo_priority_jobs_scheduled",
      expectedDomainPriority: 2,
      filters: demoFilters,
      inserted: result.insertedCount,
      skipped: result.skippedCount,
      enqueued: result.enqueuedCount,
      jobIds: result.jobs.map((job) => job.id)
    },
    "Demo priority jobs scheduled"
  );
}

scheduleDemoPriorityJobs()
  .catch((error: unknown) => {
    logger.error(
      {
        event: "demo_priority_jobs_failed",
        error: error instanceof Error ? error.message : String(error)
      },
      "Demo priority scheduling failed"
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueue();
    await closeDb();
  });
