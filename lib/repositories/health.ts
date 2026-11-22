import type { Tx } from "@/lib/db/client";

/**
 * Read-only probes for `GET /api/health` (SPECIFICATION §9). The migration ledger
 * lives outside `public` and is not exposed through RLS, so this repo is system-scope.
 */
export function healthRepo(tx: Tx) {
  return {
    /** Supabase projects may not have app_meta; the caller reports "unknown" rather than 500. */
    async schemaMigrations(): Promise<{ version: string; appliedAt: Date }[] | null> {
      const [exists] = await tx<{ present: boolean }[]>`
        select exists (
          select 1 from information_schema.tables
          where table_schema = 'app_meta' and table_name = 'schema_migrations'
        ) as present
      `;
      if (!exists?.present) return null;
      const rows = await tx<{ version: string; applied_at: Date }[]>`
        select version, applied_at from app_meta.schema_migrations order by version
      `;
      return rows.map((r) => ({ version: r.version, appliedAt: r.applied_at }));
    },
  };
}
