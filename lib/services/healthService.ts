import { forbidden } from "@/lib/errors";
import { asSystem, withRepos } from "@/lib/repositories";
import { getWorkspaceContext } from "./creatorService";

/**
 * `GET /api/health` (§9). Authenticated and scoped to the caller's workspace: last runs
 * carry creator handles, which are tenant data, so this is not a public probe. Build and
 * migration state are safe to show an owner or admin.
 */

export interface HealthCreator {
  id: string;
  username: string;
  status: string;
  lastRun: {
    status: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    errorCode: string | null;
  } | null;
}

export interface HealthReport {
  status: "ok" | "degraded";
  build: string;
  migrations: { applied: number; latest: string | null } | null;
  creators: HealthCreator[];
}

export async function getHealth(userId: string): Promise<HealthReport> {
  const context = await getWorkspaceContext(userId);
  // Lists every creator in the workspace, so a creator login (D-011) may not read it.
  if (context.role === "creator") throw forbidden("Only agency staff can see system health.");
  const [migrations, runs] = await Promise.all([
    withRepos(asSystem(), (r) => r.health.schemaMigrations()),
    withRepos(asSystem(), (r) => r.runs.latestForWorkspace(context.workspaceId)),
  ]);

  const creators: HealthCreator[] = runs.map((row) => ({
    id: row.creatorId,
    username: row.username,
    status: row.creatorStatus,
    lastRun:
      row.run === null
        ? null
        : {
            status: row.run.status,
            startedAt: row.run.startedAt,
            finishedAt: row.run.finishedAt,
            errorCode: row.run.errorCode,
          },
  }));

  const degraded =
    creators.some((c) => c.status === "needs_reauth") ||
    creators.some((c) => c.lastRun?.status === "failed");

  return {
    status: degraded ? "degraded" : "ok",
    build: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    migrations: migrations === null ? null : { applied: migrations.length, latest: migrations.at(-1)?.version ?? null },
    creators,
  };
}
