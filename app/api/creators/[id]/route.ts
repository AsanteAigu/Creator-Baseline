import { NextResponse } from "next/server";
import { handle, requireUserId, uuidParam } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rateLimit";
import { deleteCreator } from "@/lib/services/deletionService";

/**
 * DELETE /api/creators/:id - disconnect and purge (SPECIFICATION §9, §11).
 *
 * The same service the account page's button calls (D-033). Owner/admin only; 5 per user
 * per 10 minutes, because each call revokes a token at Meta.
 */
export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const id = uuidParam.parse((await ctx.params).id);
  await enforceRateLimit(`delete:${userId}`, 5, 600);
  await deleteCreator(userId, id);
  return new NextResponse(null, { status: 204 });
});
