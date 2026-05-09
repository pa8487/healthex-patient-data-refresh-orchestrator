import type { FastifyPluginAsync } from "fastify";
import { REFRESH_JOBS_QUEUE_NAME } from "../queue/queue.js";
import { scheduleEligibleRefreshJobs } from "../scheduler/scheduler.js";
import type { ScheduleFilters } from "../repositories/patientStudyRepository.js";

type ScheduleRequestBody = {
  patientIds?: unknown;
  studyIds?: unknown;
  endpoints?: unknown;
};

function parseStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Schedule filters must be arrays of strings");
  }

  return value;
}

function parseScheduleFilters(body: ScheduleRequestBody | undefined): ScheduleFilters {
  return {
    patientIds: parseStringArray(body?.patientIds),
    studyIds: parseStringArray(body?.studyIds),
    endpoints: parseStringArray(body?.endpoints)
  };
}

export const refreshRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: ScheduleRequestBody }>("/schedule", async (request, reply) => {
    let filters: ScheduleFilters;

    try {
      filters = parseScheduleFilters(request.body);
    } catch (error) {
      return reply.code(400).send({
        status: "invalid_request",
        message: error instanceof Error ? error.message : "Invalid schedule request"
      });
    }

    const result = await scheduleEligibleRefreshJobs(filters);

    app.log.info(
      {
        eligibleStudies: result.eligibleStudyCount,
        candidates: result.candidateCount,
        inserted: result.insertedCount,
        skipped: result.skippedCount,
        enqueued: result.enqueuedCount,
        filters
      },
      "Scheduling pass completed"
    );

    return reply.code(202).send({
      status: "scheduled",
      queue: REFRESH_JOBS_QUEUE_NAME,
      eligibleStudies: result.eligibleStudyCount,
      candidates: result.candidateCount,
      inserted: result.insertedCount,
      skipped: result.skippedCount,
      enqueued: result.enqueuedCount,
      jobIds: result.jobs.map((job) => job.id)
    });
  });
};
