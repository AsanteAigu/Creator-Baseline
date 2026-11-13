import { NextResponse } from "next/server";
import { notFound } from "@/lib/errors";
import { handle, requireUserId, uuidParam } from "@/lib/http";
import { getLatestReport } from "@/lib/services/creatorService";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const id = uuidParam.parse((await ctx.params).id);
  const report = await getLatestReport(userId, id);
  if (!report) throw notFound("A report");
  return NextResponse.json(report);
});
