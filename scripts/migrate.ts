import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { closeDb, query } from "../src/db/db.js";

const schemaPath = join(process.cwd(), "src/db/schema.sql");

async function migrate(): Promise<void> {
  const schema = await readFile(schemaPath, "utf8");
  await query(schema);

  console.log(
    JSON.stringify({
      event: "db_schema_applied",
      schemaPath
    })
  );
}

migrate()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "db_schema_failed",
        error: error instanceof Error ? error.message : String(error)
      })
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
