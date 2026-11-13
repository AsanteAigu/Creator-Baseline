import postgres from "postgres";
import { serverEnv } from "@/lib/config";

/**
 * Only lib/repositories may import this module (enforced by ESLint).
 *
 * Every query runs inside a transaction opened by `inScope`:
 *  - user scope: `SET LOCAL ROLE authenticated` + the JWT claims Supabase's auth.uid() reads,
 *    so Postgres RLS is the gate, exactly as it would be through PostgREST;
 *  - system scope: the connection's own role (service-level), for background jobs only.
 */

export type Tx = postgres.TransactionSql;

export type Scope = { kind: "user"; userId: string } | { kind: "system" };

const NUMERIC_OID = 1700;

let pool: postgres.Sql | undefined;

function sql(): postgres.Sql {
  if (pool) return pool;
  const url = serverEnv().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  pool = postgres(url, {
    max: 5,
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
    onnotice: () => {},
    types: {
      // numeric arrives as a string by default; every numeric we store fits a double.
      numeric: {
        to: NUMERIC_OID,
        from: [NUMERIC_OID],
        serialize: (v: number) => String(v),
        parse: (v: string) => Number(v),
      },
    },
  });
  return pool;
}

export async function inScope<T>(scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await sql().begin(async (tx) => {
    if (scope.kind === "user") {
      await tx`select set_config('role', 'authenticated', true)`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: scope.userId, role: "authenticated" })}, true)`;
    }
    return fn(tx);
  });
  return result as T;
}

/** For scripts and tests that need to release the pool so the process can exit. */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/** Postgres unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}
