import { NextResponse } from "next/server";
import { handle, requireUserId, uuidParam } from "@/lib/http";
import { getOverview } from "@/lib/services/creatorService";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const id = uuidParam.parse((await ctx.params).id);
  return NextResponse.json(await getOverview(userId, id));
});
