import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { closeDb, query, withTransaction } from "../src/db/db.js";

const schemaPath = join(process.cwd(), "src/db/schema.sql");

const studies = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Cardiology Outcomes",
    refreshFrequencyMinutes: 720,
    defaultPriority: 2
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Diabetes Remote Monitoring",
    refreshFrequencyMinutes: 360,
    defaultPriority: 2
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Low Priority Backfill",
    refreshFrequencyMinutes: 1440,
    defaultPriority: 1
  }
];

const patients = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    externalId: "ehr-1001",
    name: "Avery Johnson"
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    externalId: "ehr-1002",
    name: "Blake Martinez"
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    externalId: "ehr-1003",
    name: "Casey Nguyen"
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    externalId: "ehr-1004",
    name: "Devon Patel"
  }
];

const patientStudies = [
  {
    patientId: patients[0].id,
    studyId: studies[0].id,
    ehrEndpoint: "epic",
    nextRefreshExpression: "NOW() - INTERVAL '10 minutes'",
    consentExpiresExpression: "NOW() + INTERVAL '10 days'"
  },
  {
    patientId: patients[1].id,
    studyId: studies[0].id,
    ehrEndpoint: "cerner",
    nextRefreshExpression: "NOW() - INTERVAL '2 hours'",
    consentExpiresExpression: "NOW() + INTERVAL '2 days'"
  },
  {
    patientId: patients[2].id,
    studyId: studies[1].id,
    ehrEndpoint: "regional",
    nextRefreshExpression: "NOW() + INTERVAL '4 hours'",
    consentExpiresExpression: null
  },
  {
    patientId: patients[3].id,
    studyId: studies[2].id,
    ehrEndpoint: "epic",
    nextRefreshExpression: "NOW() + INTERVAL '1 day'",
    consentExpiresExpression: null
  },
  {
    patientId: patients[0].id,
    studyId: studies[1].id,
    ehrEndpoint: "cerner",
    nextRefreshExpression: "NOW() - INTERVAL '30 minutes'",
    consentExpiresExpression: "NOW() + INTERVAL '12 hours'"
  }
];

async function seed(): Promise<void> {
  const schema = await readFile(schemaPath, "utf8");
  await query(schema);

  await withTransaction(async (client) => {
    for (const study of studies) {
      await client.query(
        `
          INSERT INTO studies (
            id,
            name,
            refresh_frequency_minutes,
            default_priority
          )
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              refresh_frequency_minutes = EXCLUDED.refresh_frequency_minutes,
              default_priority = EXCLUDED.default_priority
        `,
        [
          study.id,
          study.name,
          study.refreshFrequencyMinutes,
          study.defaultPriority
        ]
      );
    }

    for (const patient of patients) {
      await client.query(
        `
          INSERT INTO patients (id, external_id, name)
          VALUES ($1, $2, $3)
          ON CONFLICT (id) DO UPDATE
          SET external_id = EXCLUDED.external_id,
              name = EXCLUDED.name
        `,
        [patient.id, patient.externalId, patient.name]
      );
    }

    for (const patientStudy of patientStudies) {
      await client.query(
        `
          INSERT INTO patient_studies (
            patient_id,
            study_id,
            ehr_endpoint,
            next_refresh_at,
            consent_expires_at
          )
          VALUES (
            $1,
            $2,
            $3,
            ${patientStudy.nextRefreshExpression},
            ${
              patientStudy.consentExpiresExpression === null
                ? "NULL"
                : patientStudy.consentExpiresExpression
            }
          )
          ON CONFLICT (patient_id, study_id) DO UPDATE
          SET ehr_endpoint = EXCLUDED.ehr_endpoint,
              next_refresh_at = EXCLUDED.next_refresh_at,
              consent_expires_at = EXCLUDED.consent_expires_at
        `,
        [
          patientStudy.patientId,
          patientStudy.studyId,
          patientStudy.ehrEndpoint
        ]
      );
    }
  });

  const [{ count: patientCount }] = (
    await query<{ count: string }>("SELECT COUNT(*) AS count FROM patients")
  ).rows;
  const [{ count: studyCount }] = (
    await query<{ count: string }>("SELECT COUNT(*) AS count FROM studies")
  ).rows;
  const [{ count: enrollmentCount }] = (
    await query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM patient_studies"
    )
  ).rows;

  console.log(
    `Seed complete: ${patientCount} patients, ${studyCount} studies, ${enrollmentCount} patient-study rows.`
  );
}

seed()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
