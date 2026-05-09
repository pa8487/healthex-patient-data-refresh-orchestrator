CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  refresh_frequency_minutes INT NOT NULL CHECK (refresh_frequency_minutes > 0),
  default_priority INT NOT NULL DEFAULT 1 CHECK (default_priority > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_studies (
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  last_refresh_at TIMESTAMPTZ NULL,
  next_refresh_at TIMESTAMPTZ NOT NULL,
  consent_expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (patient_id, study_id)
);

ALTER TABLE patient_studies
  DROP COLUMN IF EXISTS ehr_endpoint;

ALTER TABLE patient_studies
  ADD COLUMN IF NOT EXISTS last_refresh_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS next_refresh_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS consent_expires_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS patient_ehr_endpoints (
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  ehr_endpoint TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (patient_id, ehr_endpoint)
);

CREATE TABLE IF NOT EXISTS refresh_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 1 CHECK (priority > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'completed', 'failed')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INT NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  error_type TEXT NULL,
  error_message TEXT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  worker_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (patient_id, study_id) REFERENCES patient_studies(patient_id, study_id) ON DELETE CASCADE,
  FOREIGN KEY (patient_id, endpoint) REFERENCES patient_ehr_endpoints(patient_id, ehr_endpoint) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_patient_studies_next_refresh
  ON patient_studies(next_refresh_at);

CREATE INDEX IF NOT EXISTS idx_refresh_jobs_status_sched_priority
  ON refresh_jobs(status, scheduled_at, priority DESC, created_at);

-- Database-enforced duplicate prevention keeps concurrent schedulers idempotent.
DROP INDEX IF EXISTS idx_unique_active_refresh_job;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_refresh_job
  ON refresh_jobs(patient_id, study_id, endpoint)
  WHERE status IN ('pending', 'claimed');

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refresh_jobs_updated_at ON refresh_jobs;

CREATE TRIGGER trg_refresh_jobs_updated_at
BEFORE UPDATE ON refresh_jobs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
