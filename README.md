# HealthEx Patient Data Refresh Orchestrator

Small TypeScript backend that schedules patient data refresh jobs for EHR endpoints. It uses Fastify for HTTP, PostgreSQL as the durable source of truth, Redis + BullMQ for dispatch, and raw SQL only.

## Setup And Run

Prerequisites:

- Node.js 20+
- Docker Compose

Install dependencies:

```bash
npm install
```

Start Postgres and Redis:

```bash
docker compose up -d postgres redis
```

Postgres is exposed on host port `55432` to avoid collisions with a local Postgres on `5432`.

Seed the database:

```bash
npm run seed
```

Expected output:

```text
Seed complete: 4 patients, 3 studies, 5 patient-study rows.
```

Run checks:

```bash
npm run typecheck
npm run build
```

Start the API:

```bash
npm run dev
```

Or, after building:

```bash
npm start
```

## Execute Scheduling

Health check:

```bash
curl -s http://127.0.0.1:3000/health
```

Trigger scheduling:

```bash
curl -s -X POST http://127.0.0.1:3000/schedule
```

After a fresh seed, 3 of the 5 seeded patient-study rows are due. The first scheduling call should create and enqueue 3 jobs:

```json
{
  "status": "scheduled",
  "queue": "refresh-jobs",
  "eligible": 3,
  "inserted": 3,
  "skipped": 0,
  "enqueued": 3,
  "jobIds": ["..."]
}
```

Calling the endpoint again should skip those same 3 rows because active jobs already exist:

```json
{
  "status": "scheduled",
  "queue": "refresh-jobs",
  "eligible": 3,
  "inserted": 0,
  "skipped": 3,
  "enqueued": 0,
  "jobIds": []
}
```

To reset local data:

```bash
docker compose down -v
docker compose up -d postgres redis
npm run seed
```

## Decisions And Tradeoffs

PostgreSQL is the system of record for refresh eligibility, job lifecycle state, and duplicate prevention. BullMQ is used only to dispatch successfully inserted work, so Redis queue state is not treated as durable business state. Duplicate active refreshes are prevented by a partial unique index on `refresh_jobs(patient_id, study_id)` for `pending` and `claimed` jobs, with inserts using `ON CONFLICT DO NOTHING`. This keeps scheduling concurrency simple and reviewable. The current scheduler is intentionally small: it handles due-row discovery, priority calculation, DB job creation, duplicate skips, and queue enqueueing, but worker execution, retry handling, and mock EHR calls are left for the next implementation slice.
