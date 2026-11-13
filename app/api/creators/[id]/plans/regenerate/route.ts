import { NextResponse } from "next/server";
import { handle, requireUserId, uuidParam } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rateLimit";
import { regeneratePlan } from "@/lib/services/planService";

/** "Regenerate on request" (§7). AI-triggering, so rate-limited per user. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const id = uuidParam.parse((await ctx.params).id);
  await enforceRateLimit(`plan:${userId}`, 3, 600);
  await regeneratePlan(userId, id);
  return new NextResponse(null, { status: 204 });
});
