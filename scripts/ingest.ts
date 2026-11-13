/**
 * Runs the ingestion pipeline once for every creator (or one, by username):
 *   pnpm ingest            all creators
 *   pnpm ingest theo.trains
 * Uses INSTAGRAM_SOURCE / AI_PROVIDER from the environment (mock by default).
 */
import "./env";
import postgres from "postgres";
import { closeDb } from "../lib/db/client";
import { ingestCreator } from "../lib/services/runService";
import { requireDatabaseUrl } from "./env";

async function main(): Promise<void> {
  const only = process.argv[2];
  const sql = postgres(requireDatabaseUrl(), { max: 1 });
  const creators = await sql<{ id: string; username: string }[]>`
    select id, username from public.creators
    where ${only ?? null}::text is null or username = ${only ?? null}
    order by username
  `;
  await sql.end();

  for (const c of creators) {
    const result = await ingestCreator(c.id, { trigger: "manual" });
    console.log(`${c.username}: ${JSON.stringify(result)}`);
  }
  await closeDb();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
