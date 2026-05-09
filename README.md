# HealthEx Patient Data Refresh Orchestrator

Small TypeScript backend that schedules patient data refresh jobs across EHR endpoints. It uses Fastify for HTTP, PostgreSQL as the durable source of truth, Redis + BullMQ for dispatch, and raw SQL only.

## Setup And Run

Prerequisites:

- Node.js 20+
- Docker Compose

Install dependencies and start infrastructure:

```bash
npm install
npm run bootstrap
```

`npm run bootstrap` starts Postgres and Redis, waits for both services, clears the local queue, applies the schema through the seed path, and loads deterministic demo data. Defaults work without a `.env` file; copy `.env.example` to `.env` only when overriding ports, database URLs, worker concurrency, or log level.

Expected seed output:

```text
Seed complete: 4 patients, 3 studies, 5 patient-study rows, 6 patient EHR endpoints.
```

To apply only the schema:

```bash
npm run db:migrate
```

Run checks:

```bash
npm run verify
```

Start the API:

```bash
npm run dev
```

## Execute Scheduling

Health check:

```bash
curl -s http://127.0.0.1:3000/health
```

Trigger a filtered scheduling batch before starting the worker:

```bash
curl -s -X POST http://127.0.0.1:3000/schedule \
  -H 'content-type: application/json' \
  -d '{
    "patientIds": ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    "studyIds": ["11111111-1111-4111-8111-111111111111"],
    "endpoints": ["epic-success"]
  }'
```

After a fresh seed, this targets one due patient-study row and one active endpoint:

```json
{
  "status": "scheduled",
  "queue": "refresh-jobs",
  "eligibleStudies": 1,
  "candidates": 1,
  "inserted": 1,
  "skipped": 0,
  "enqueued": 1,
  "jobIds": ["..."]
}
```

Then run the unfiltered scheduler. It should find all due work, skip the already-active filtered job, and create the remaining due endpoint jobs:

```bash
curl -s -X POST http://127.0.0.1:3000/schedule
```

Expected shape:

```json
{
  "status": "scheduled",
  "queue": "refresh-jobs",
  "eligibleStudies": 3,
  "candidates": 6,
  "inserted": 5,
  "skipped": 1,
  "enqueued": 5,
  "jobIds": ["..."]
}
```

After confirming jobs were scheduled, start the refresh worker in a second terminal:

```bash
npm run worker
```

The worker consumes BullMQ jobs from `refresh-jobs`, atomically claims each DB job, respects endpoint throttling, calls the in-process mock EHR start/status flow, and updates `refresh_jobs` plus `patient_studies`. Seeded endpoints cover success, transient retry, rate-limit retry, and permanent failure cases.

Logs are structured JSON. Useful event names to follow are `schedule_request_received`, `schedule_candidates_found`, `schedule_jobs_enqueued`, `refresh_job_dequeued`, `refresh_claim_attempt`, `refresh_job_claimed`, `mock_ehr_refresh_started`, `refresh_retry_scheduled`, `refresh_job_completed`, and `refresh_job_failed`.

## Query The Database

Open `psql` inside the Postgres container:

```bash
docker compose exec postgres psql -U healthex -d healthex
```

Useful queries:

```sql
SELECT * FROM patients;
SELECT * FROM studies;
SELECT * FROM patient_studies ORDER BY next_refresh_at;
SELECT * FROM patient_ehr_endpoints ORDER BY patient_id, ehr_endpoint;
SELECT id, patient_id, study_id, endpoint, status, attempts, scheduled_at, error_type
FROM refresh_jobs
ORDER BY created_at;
```

Or run a one-off query without entering `psql`:

```bash
docker compose exec postgres psql -U healthex -d healthex \
  -c "SELECT status, COUNT(*) FROM refresh_jobs GROUP BY status;"
```

To reset local data:

```bash
docker compose down -v
npm run bootstrap
```

## Decisions And Tradeoffs

PostgreSQL is the system of record for refresh eligibility, job lifecycle state, and duplicate prevention. Patient-study enrollment owns refresh schedule state, while `patient_ehr_endpoints` tracks patient-level EHR connections; scheduled work is expanded into endpoint-specific jobs. Duplicate active refreshes are prevented by a partial unique index on `refresh_jobs(patient_id, study_id, endpoint)` for `pending` and `claimed` jobs. BullMQ handles dispatch and delayed retries, but workers still claim in Postgres before processing so duplicate queue deliveries cannot double-process a DB job. Rate limiting and mock EHR behavior are intentionally small and explicit for the exercise.
