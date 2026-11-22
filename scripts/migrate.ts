/**
 * Applies supabase/migrations/*.sql in filename order to DATABASE_URL.
 *
 * Supabase projects should use `supabase db push`; this runner exists so the schema can be
 * applied to plain local Postgres (with supabase/local/auth-shim.sql) without Docker.
 * Applied versions are tracked in app_meta.schema_migrations.
 *
 *   pnpm db:migrate            apply pending migrations
 *   pnpm db:migrate --reset    drop the app schema first (refuses on a Supabase host)
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { requireDatabaseUrl } from "./env";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const SHIM_PATH = path.join(process.cwd(), "supabase", "local", "auth-shim.sql");

async function main(): Promise<void> {
  const url = requireDatabaseUrl();
  const reset = process.argv.includes("--reset");
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    if (reset) {
      if (/supabase\.(co|com)/.test(url)) {
        throw new Error("Refusing --reset against a Supabase-hosted database.");
      }
      await sql.unsafe(`
        drop schema if exists public cascade;
        drop schema if exists app_meta cascade;
        create schema public;
      `);
      console.log("reset: dropped public and app_meta schemas");
    }

    // GoTrue's auth.users has instance_id; the local shim's does not.
    const [probe] = await sql<{ is_supabase: boolean }[]>`
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'auth' and table_name = 'users' and column_name = 'instance_id'
      ) as is_supabase
    `;
    if (!probe?.is_supabase) {
      await sql.unsafe(await readFile(SHIM_PATH, "utf8"));
      console.log("applied local auth shim (not a Supabase database)");
    }
    // Idempotent; needed after --reset recreates the public schema without its grants.
    await sql.unsafe(`grant usage on schema public to anon, authenticated, service_role`);

    await sql.unsafe(`
      create schema if not exists app_meta;
      create table if not exists app_meta.schema_migrations (
        version    text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set(
      (await sql<{ version: string }[]>`select version from app_meta.schema_migrations`).map((r) => r.version),
    );

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      // One transaction per file: a failing migration leaves no partial schema behind.
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into app_meta.schema_migrations (version) values (${file})`;
      });
      console.log(`applied ${file}`);
      count += 1;
    }
    console.log(count === 0 ? "schema up to date" : `${count} migration(s) applied`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
