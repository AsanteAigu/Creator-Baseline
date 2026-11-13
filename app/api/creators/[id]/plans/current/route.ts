import { NextResponse } from "next/server";
import { notFound } from "@/lib/errors";
import { handle, requireUserId, uuidParam } from "@/lib/http";
import { getCurrentPlan } from "@/lib/services/planService";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const id = uuidParam.parse((await ctx.params).id);
  const plan = await getCurrentPlan(userId, id);
  if (!plan) throw notFound("This week's plan");
  return NextResponse.json(plan);
});
