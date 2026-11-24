import { after, NextResponse } from "next/server";
import { handle, requireUserId, uuidParam } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requestManualRun } from "@/lib/services/creatorService";

/** The written summary runs after the response (D-048) and needs the same headroom as a job. */
export const maxDuration = 300;

/** Manual update. Owner/admin only (service), 5 per user per 10 minutes. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const id = uuidParam.parse((await ctx.params).id);
  await enforceRateLimit(`runs:${userId}`, 5, 600);
  const result = await requestManualRun(userId, id, (task) => after(task));
  return NextResponse.json(result, { status: result.status === "failed" ? 200 : 201 });
});
