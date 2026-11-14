import { NextResponse } from "next/server";
import { handle, requireUserId, uuidParam } from "@/lib/http";
import { removeMember } from "@/lib/services/memberService";

/** DELETE /api/settings/members/:userId - remove someone's access to the agency. */
export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ userId: string }> }) => {
  const userId = await requireUserId();
  const target = uuidParam.parse((await ctx.params).userId);
  await removeMember(userId, target);
  return new NextResponse(null, { status: 204 });
});
