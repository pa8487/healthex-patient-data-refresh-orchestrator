# HealthEx Data Refresh Orchestrator

## Goal

Build a small but realistic backend system that schedules, executes, and tracks patient data refresh jobs across external EHR endpoints.

This implementation is optimized for the exercise, not for a fully productionized 10M-patient system. The goal is to show strong senior-level judgment in:

- data modeling
- worker coordination
- retries and failure handling
- rate limiting
- duplicate prevention
- clear tradeoff reasoning

The system should be runnable locally with Docker Compose and easy for reviewers to understand.

---

## Exercise Fit

The exercise explicitly asks for:

- mocked external EHR APIs
- real orchestration logic
- queue, database, scheduling logic, and worker coordination that actually work
- runnable locally
- discussion of scaling from 5K to 10M patients

The best architecture for this exercise is **not** the most distributed or fancy architecture. It is the simplest architecture that still demonstrates:

- safe concurrency
- durable state
- retry handling
- rate limit awareness
- clean scaling path

Because of that, this project will use:

- **Fastify** for HTTP endpoints
- **TypeScript** for readability and type safety
- **PostgreSQL** as the durable system of record
- **Redis + BullMQ** as the execution queue and delayed retry layer
- **Docker Compose** for reproducibility

---

## Why This Architecture Is Best For This Exercise

### 1. PostgreSQL as the source of truth

Postgres is the best fit here because the core problem is not just asynchronous execution. It is also:

- scheduling based on timestamps
- preventing duplicate jobs
- tracking job state transitions
- handling retries and failure reasons
- maintaining patient-study refresh metadata
- supporting atomic worker claims

This is relational and transactional. Postgres handles this very well.

### 2. BullMQ as the execution layer

BullMQ is used to dispatch work to workers and handle delayed retries cleanly. It is **not** the source of truth. Postgres remains the authoritative store for:

- whether a job exists
- job lifecycle state
- attempts
- failure metadata
- scheduling timestamps

BullMQ improves:

- worker throughput
- delayed execution
- retry dispatch
- operational simplicity

### 3. Fastify over Express

Fastify is chosen because:

- better TypeScript support
- lower overhead
- simpler validation story
- modern backend stack

The HTTP surface is small, so Fastify keeps the app clean without introducing a heavy framework.

### 4. Docker Compose

Docker Compose is included so reviewers can run:

```bash
docker compose up
```

and have Postgres + Redis available immediately. This lowers friction and makes the submission feel professional.

---

## Non-Goals

This implementation will intentionally avoid:

- microservices
- Kafka
- Temporal
- Kubernetes
- Prisma or other ORM-heavy abstractions
- event sourcing
- elaborate domain-driven architecture

Those can be valid in larger systems, but they are not the best fit for a 2-4 hour exercise. They would add complexity without improving the evaluation signal.

---

## High-Level Architecture

```text
          +----------------------+
          |    Fastify API       |
          |  - schedule trigger  |
          |  - health endpoint   |
          |  - optional metrics  |
          +----------+-----------+
                     |
                     v
          +----------------------+
          |      Scheduler       |
          | finds eligible work  |
          | inserts DB jobs      |
          | enqueues BullMQ jobs |
          +----------+-----------+
                     |
                     v
          +----------------------+
          |      PostgreSQL      |
          | source of truth for  |
          | patients/studies/jobs|
          +----------+-----------+
                     |
                     v
          +----------------------+
          |    Redis + BullMQ    |
          | execution + delays   |
          +----------+-----------+
                     |
         +-----------+-----------+
         |                       |
         v                       v
+------------------+    +------------------+
|     Worker 1     |    |     Worker 2     |
| process refresh  |    | process refresh  |
+---------+--------+    +---------+--------+
          |                       |
          +-----------+-----------+
                      |
                      v
           +----------------------+
           |   Mock EHR Service   |
           | success / transient  |
           | permanent / 429      |
           +----------------------+
```

---

## Core Design Principles

### 1. Durable state lives in Postgres

Every important state transition is recorded in the database.

### 2. Queue is an execution accelerator, not the database

BullMQ is useful, but jobs should not exist only in Redis. Redis is fast but not the main durable business record.

### 3. Duplicate prevention must be enforced by the database

Do not rely only on application checks. Use unique constraints and idempotency-friendly inserts.

### 4. Retries should be explicit

Transient failures retry with exponential backoff. Permanent failures do not retry.

### 5. Scheduling should be incremental

Do not scan everything unnecessarily. Use indexed timestamps like `next_refresh_at`.

### 6. Keep the code easy to explain

Interviewers should be able to understand the code quickly during the walkthrough.

---

## Scope of the MVP

The MVP will support:

- track patients and studies
- determine refresh eligibility using `next_refresh_at`
- create refresh jobs for eligible patient-study pairs
- prevent duplicate active jobs
- enqueue jobs for workers
- simulate EHR refresh responses
- handle success
- retry transient and rate-limit failures
- mark permanent failures without retry
- update `last_refresh_at` and `next_refresh_at` on success
- run multiple workers safely
- expose simple API endpoints for demo/testing

Optional but nice if time allows:

- priority scoring
- jitter to spread load
- endpoint-specific throttling
- manual refresh trigger
- status endpoint
- seed script

---

## Data Model

### Table: patients

Tracks patient identity used by the orchestrator.

Suggested columns:

- `id UUID PRIMARY KEY`
- `external_id TEXT NULL`
- `name TEXT`
- `created_at TIMESTAMP NOT NULL DEFAULT NOW()`

### Table: studies

Tracks refresh policy at the study level.

Suggested columns:

- `id UUID PRIMARY KEY`
- `name TEXT NOT NULL`
- `refresh_frequency_minutes INT NOT NULL`
- `default_priority INT NOT NULL DEFAULT 1`
- `created_at TIMESTAMP NOT NULL DEFAULT NOW()`

### Table: patient_studies

Represents a patient enrolled in a study and where/how that refresh occurs.

Suggested columns:

- `patient_id UUID NOT NULL`
- `study_id UUID NOT NULL`
- `ehr_endpoint TEXT NOT NULL`
- `last_refresh_at TIMESTAMP NULL`
- `next_refresh_at TIMESTAMP NOT NULL`
- `consent_expires_at TIMESTAMP NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT NOW()`
- primary key: `(patient_id, study_id)`

Notes:

- `next_refresh_at` is the key scheduling field
- `ehr_endpoint` allows endpoint-aware rate limiting
- consent expiry can later be used to increase priority

### Table: refresh_jobs

Tracks lifecycle for each refresh attempt.

Suggested columns:

- `id UUID PRIMARY KEY`
- `patient_id UUID NOT NULL`
- `study_id UUID NOT NULL`
- `endpoint TEXT NOT NULL`
- `priority INT NOT NULL DEFAULT 1`
- `status TEXT NOT NULL`
- `attempts INT NOT NULL DEFAULT 0`
- `max_attempts INT NOT NULL DEFAULT 5`
- `error_type TEXT NULL`
- `error_message TEXT NULL`
- `scheduled_at TIMESTAMP NOT NULL`
- `claimed_at TIMESTAMP NULL`
- `completed_at TIMESTAMP NULL`
- `worker_id TEXT NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMP NOT NULL DEFAULT NOW()`

Valid statuses:

- `pending`
- `claimed`
- `completed`
- `failed`

Notes:

- keep status model simple
- retries can remain `pending` with a future `scheduled_at`
- no need for many extra states in the MVP

---

## Critical Indexes and Constraints

### 1. Scheduling lookup

```sql
CREATE INDEX idx_patient_studies_next_refresh
ON patient_studies(next_refresh_at);
```

### 2. Claimable jobs lookup

```sql
CREATE INDEX idx_refresh_jobs_status_sched_priority
ON refresh_jobs(status, scheduled_at, priority DESC, created_at);
```

### 3. Prevent duplicate active jobs

```sql
CREATE UNIQUE INDEX idx_unique_active_refresh_job
ON refresh_jobs(patient_id, study_id)
WHERE status IN ('pending', 'claimed');
```

This is one of the most important design choices in the system. It prevents duplicate active refreshes even if scheduling logic runs concurrently.

---

## Job Lifecycle

### 1. Eligible patient-study discovered

Scheduler finds rows in `patient_studies` where:

- `next_refresh_at <= NOW()`

### 2. Job inserted in Postgres

A new row is created in `refresh_jobs` with:

- `status = pending`
- `scheduled_at = NOW()`
- priority derived from study or business rules

If a duplicate active job already exists, the insert should fail cleanly and be ignored.

### 3. Job enqueued to BullMQ

The job ID is placed on the execution queue.

### 4. Worker processes the job

Worker loads the DB row, marks it `claimed`, calls the mock EHR API, and updates the database based on result.

### 5. On success

- job status becomes `completed`
- `completed_at` is recorded
- `patient_studies.last_refresh_at = NOW()`
- `patient_studies.next_refresh_at` moves forward by study frequency

### 6. On transient failure

- increment attempts
- compute retry delay with exponential backoff
- update `scheduled_at` to future time
- set status back to `pending`
- re-enqueue delayed BullMQ job

### 7. On permanent failure

- set status to `failed`
- record `error_type` and `error_message`
- do not retry

---

## Scheduler Design

### Scheduler responsibility

The scheduler only decides what work should exist. It should not directly perform the refresh call.

Responsibilities:

- read eligible patient-study rows
- compute priority
- insert DB job if no active job exists
- enqueue created jobs

### Why this design

This separates:

- scheduling concerns
- execution concerns

It also makes the system easier to reason about and demo.

### Scheduler trigger model for the exercise

For the exercise, simplest implementation is:

- an HTTP endpoint like `POST /schedule`
- optionally also a periodic interval timer for local demo

This is enough to demonstrate behavior without building a full cron subsystem.

---

## Worker Design

### Worker responsibility

Workers:

- receive a BullMQ job containing `refreshJobId`
- load and validate the DB row
- atomically transition it to `claimed`
- execute the mock EHR refresh
- update DB based on outcome
- re-enqueue if retryable

### Important rule

Workers should never assume Redis alone is correct. They must verify and update state in Postgres.

### Why this matters

If Redis and DB ever diverge, the DB remains authoritative.

---

## Atomic Claim Strategy

For the MVP, there are two possible approaches.

### Option A: BullMQ-driven with DB state check

- scheduler inserts DB job
- scheduler enqueues BullMQ job
- worker receives queue event
- worker updates DB from `pending` to `claimed` if still claimable

Example pattern:

```sql
UPDATE refresh_jobs
SET status = 'claimed',
    claimed_at = NOW(),
    worker_id = $2,
    updated_at = NOW()
WHERE id = $1
  AND status = 'pending'
  AND scheduled_at <= NOW()
RETURNING *;
```

If this returns no rows, another worker or retry path already handled it.

### Option B: DB-native claiming with `FOR UPDATE SKIP LOCKED`

- workers poll DB directly for claimable jobs
- Redis queue becomes optional

This is excellent from a concurrency correctness perspective, but it partially overlaps with what BullMQ already does.

### Best choice for this exercise

Use **Option A**.

Reason:

- simpler to implement in limited time
- still demonstrates good DB discipline
- easier local demo
- cleanly uses BullMQ for what it is good at
- avoids building a second scheduler/claim loop on top of the queue

In the walkthrough, mention that at larger scale or in a queue-less design, `FOR UPDATE SKIP LOCKED` would be a strong option.

---

## Retry Strategy

Retry only for:

- transient failures
- rate limiting

Do not retry:

- permanent failures

### Suggested failure mapping

- `TRANSIENT` -> retry
- `RATE_LIMIT` -> retry
- `PERMANENT` -> fail terminally

### Backoff formula

Use exponential backoff with cap.

Example:

- attempt 1 -> 30s
- attempt 2 -> 60s
- attempt 3 -> 120s
- attempt 4 -> 240s
- cap at 1 hour

Pseudo:

```ts
delayMs = Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);
```

### Why exponential backoff

It is simple, standard, and demonstrates operational maturity.

Optional improvement:

- add jitter to avoid synchronized retry storms

---

## Priority Model

The exercise mentions prioritization. Keep the model simple.

Suggested priority buckets:

- `3` = user-triggered / urgent / consent expiring
- `2` = normal scheduled refresh
- `1` = low urgency or backfill-like work

For the MVP:

- study default priority can be used
- optionally elevate if `consent_expires_at` is near

### Why simple priority is enough

The exercise wants to see reasoning, not a full scheduling optimizer.

---

## Rate Limiting Strategy

The prompt mentions endpoint-specific rate limits:

- Epic: about 100 req/min
- others: about 30 req/min

### MVP approach

Do not try to build a perfect distributed rate limiter in 2-4 hours.

Use a pragmatic strategy:

- one BullMQ worker configuration per endpoint family
- or simple per-endpoint token buckets in Redis
- or serial throttling in code for the demo

### Best exercise choice

Implement a lightweight **Redis-backed endpoint throttle helper** or, if time is short, separate queues or worker settings per endpoint.

Example policy:

- `epic` -> allow ~100/min
- `cerner` or `regional` -> allow ~30/min

### Important note

Be transparent in README that this is an MVP throttle and that true global distributed rate limiting would be strengthened for production.

---

## Mock External API Design

The mock service should simulate:

- success
- transient failure
- permanent failure
- rate limit failure

Suggested probabilities:

- 60% success
- 20% transient
- 10% rate limit
- 10% permanent

This makes the demo interesting and exercises retry logic.

Suggested return shape:

```ts
type MockRefreshResult =
  | { success: true }
  | {
      success: false;
      type: "TRANSIENT" | "RATE_LIMIT" | "PERMANENT";
      message: string;
    };
```

Optional improvement:

- make outcome deterministic by patient ID hash for reproducible demos

---

## API Endpoints

Keep HTTP surface minimal.

### `GET /health`

Returns simple readiness response.

### `POST /schedule`

Runs scheduling pass for eligible patient-study rows.

### Optional: `POST /patients/:patientId/refresh`

Creates a high-priority manual refresh job.

### Optional: `GET /jobs/:id`

Returns DB-backed job state for debugging/demo.

These are enough for the exercise.

---

## Project Structure

```text
healthex-orchestrator/
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── PROJECT_PLAN.md
├── src/
│   ├── index.ts
│   ├── config/
│   │   └── env.ts
│   ├── db/
│   │   ├── db.ts
│   │   ├── migrate.ts
│   │   └── schema.sql
│   ├── routes/
│   │   ├── healthRoutes.ts
│   │   └── refreshRoutes.ts
│   ├── scheduler/
│   │   ├── scheduler.ts
│   │   └── priority.ts
│   ├── queue/
│   │   ├── queue.ts
│   │   └── endpointThrottle.ts
│   ├── workers/
│   │   └── refreshWorker.ts
│   ├── repositories/
│   │   ├── patientStudyRepository.ts
│   │   └── refreshJobRepository.ts
│   ├── services/
│   │   ├── mockEhrApi.ts
│   │   ├── refreshExecutor.ts
│   │   └── retryPolicy.ts
│   ├── types/
│   │   └── domain.ts
│   └── utils/
│       └── logger.ts
└── scripts/
    └── seed.ts
```

---

## Coding Style Guidance

### Use raw SQL, not ORM

Reason:

- simpler for this exercise
- clearer concurrency behavior
- easier to review
- avoids ORM hiding important SQL decisions

### Keep repository layer thin

Do not create deep abstraction stacks. Small repositories are fine, but business logic should remain readable.

### Prefer explicitness over cleverness

This code should look like a clean PR, not a framework demo.

### Add concise comments where logic is not obvious

Especially around:

- duplicate prevention
- retries
- why Postgres is authoritative
- worker claim transition

---

## Implementation Order

### Phase 1: bootstrap

- initialize TypeScript + Fastify project
- add Docker Compose with Postgres + Redis
- create DB connection
- add schema and migration runner

### Phase 2: domain persistence

- implement tables
- add repository helpers
- add seed script with patients/studies/patient_studies

### Phase 3: scheduling

- implement eligibility query on `next_refresh_at`
- insert refresh jobs
- enforce duplicate prevention with unique partial index
- enqueue BullMQ jobs

### Phase 4: execution

- implement BullMQ worker
- add claim transition from `pending` to `claimed`
- integrate mock EHR API
- handle success/failure/retry

### Phase 5: polish

- add health endpoint
- add schedule endpoint
- improve logs
- add README
- add design notes for scaling

Optional Phase 6:

- manual refresh
- status endpoint
- endpoint-specific throttling improvement
- jitter
- simple metrics

---

## Logging and Demo Experience

Add logs that make flow easy to see.

Examples:

- scheduler found N eligible patient-study rows
- job created
- duplicate skipped
- worker claimed job
- endpoint throttled
- transient failure, retry scheduled
- permanent failure, job failed
- success, next refresh scheduled

Good logs make the demo much stronger.

---

## Test / Demo Scenario

Seed local DB with:

- several patients
- multiple studies
- mixed endpoints
- varied `next_refresh_at` values
- at least one patient due for refresh now
- at least one future-scheduled patient
- at least one consent-near-expiry patient if priority boost is implemented

Demo flow:

1. run docker compose
2. start API and worker
3. trigger `POST /schedule`
4. show logs for job creation
5. show worker processing
6. show retries on transient/rate-limit outcomes
7. show terminal failure on permanent outcome
8. query DB or endpoint to show final state

---

## Tradeoffs

### Why not use only Postgres with worker polling?

That is viable and can be very strong, especially using `FOR UPDATE SKIP LOCKED`. But for this exercise, combining Postgres with BullMQ gives:

- simpler delayed retries
- easier local execution model
- clearer async pipeline
- less custom queue code

### Why not use only BullMQ without Postgres job state?

Because job history and scheduling state are important business data. Queue state alone is not enough for:

- durable auditability
- relational queries
- explicit scheduling logic
- clean demo of system state

### Why not use Prisma?

Prisma is productive, but raw SQL is better here because:

- partial unique indexes matter
- claim/update semantics should be explicit
- interviewers can see the actual concurrency logic

### Why not use cron or a workflow engine?

The exercise does not require a production scheduler framework. A simple scheduler trigger is enough.

---

## What To Emphasize In The Interview

### 1. Postgres is the system of record

This is the most important architecture statement.

### 2. Duplicate prevention is enforced in the database

Do not rely on best effort checks.

### 3. BullMQ is used for execution and delayed retries

Not as the durable business state store.

### 4. Retry policy distinguishes transient vs permanent failure

This shows practical backend thinking.

### 5. The architecture is intentionally simple

You are optimizing for correctness and clarity, not buzzwords.

### 6. There is a clean scaling path

The MVP is small, but the concepts generalize well.

---

## Scaling Notes For Part 2

This project is an MVP for local/demo scale. To scale from 5K to 10M patients, the design would evolve in the following ways:

### 1. Partition scheduling

Avoid broad scans. Partition work by:

- endpoint
- tenant
- patient ID hash
- time bucket

### 2. Smarter scheduler topology

Run multiple schedulers responsible for disjoint partitions rather than one global scheduler.

### 3. Stronger distributed rate limiting

Move from local throttle logic to robust Redis token buckets or endpoint-aware control planes.

### 4. Retry storm protection

Add:

- jitter
- max retry caps
- dead-letter queues
- endpoint health/circuit breaker logic

### 5. Better observability

Track:

- queue lag
- job throughput
- refresh latency
- endpoint error rates
- retry volume
- cost per successful refresh

### 6. Cost optimization

Avoid redundant work via:

- duplicate suppression
- coalescing manual + scheduled refreshes
- adaptive refresh frequency
- skipping unchanged data pulls when possible

### 7. Storage and DB scaling

Eventually add:

- partitioned tables
- archival strategy
- read replicas
- write partitioning if needed

---

## README Expectations

README should include:

1. setup and run instructions
2. architecture summary
3. key design decisions
4. tradeoffs
5. future improvements
6. sample API usage
7. how AI was used, if applicable

---

## Guidance For Codex

When generating code from this plan, follow these rules:

- Use TypeScript
- Use Fastify
- Use PostgreSQL via `pg`
- Use BullMQ with Redis
- Use raw SQL, not Prisma or ORM
- Keep Postgres as the durable source of truth
- Keep repository layer thin
- Use clean file boundaries
- Prefer readability over abstraction
- Add concise comments only where needed
- Do not introduce microservices
- Do not introduce Kafka
- Do not introduce Kubernetes
- Do not introduce workflow engines
- Implement in small, reviewable steps

Suggested build order for Codex:

1. package.json + tsconfig + docker-compose
2. DB connection + schema
3. Fastify bootstrap + health route
4. seed script
5. queue setup
6. scheduler
7. worker
8. retry policy
9. mock EHR API
10. README polish

---

## Final Architecture Decision

For this exercise, the best architecture is:

- **Fastify** for small HTTP surface
- **PostgreSQL** for durable scheduling + lifecycle state
- **BullMQ + Redis** for work dispatch and delayed retries
- **raw SQL** for clarity and correctness
- **simple scheduler + worker split** for clean reasoning
- **Docker Compose** for easy evaluation

This gives the strongest balance of:

- correctness
- speed of implementation
- interview clarity
- startup pragmatism
- clean scaling story
