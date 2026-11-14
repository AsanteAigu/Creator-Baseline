import { NextResponse } from "next/server";
import { handle, requireUserId, uuidParam } from "@/lib/http";
import { revokeInvite } from "@/lib/services/memberService";

/** DELETE /api/settings/invites/:id - cancel a pending invite link. */
export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const id = uuidParam.parse((await ctx.params).id);
  await revokeInvite(userId, id);
  return new NextResponse(null, { status: 204 });
});
