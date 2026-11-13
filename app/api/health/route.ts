import { NextResponse } from "next/server";
import { handle, requireUserId } from "@/lib/http";
import { getHealth } from "@/lib/services/healthService";

/**
 * GET /api/health - build, migration state and the last run per creator.
 *
 * Authenticated and workspace-scoped on purpose: last-run data carries creator handles,
 * which are tenant data. A degraded report is a 200 with `status: "degraded"` so a monitor
 * can distinguish "reachable but unhealthy" from "unauthorised" (D-034).
 */
export const GET = handle(async () => {
  const userId = await requireUserId();
  return NextResponse.json(await getHealth(userId));
});
