import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, readJson, requireUserId, uuidParam } from "@/lib/http";
import { setSuggestionStatus } from "@/lib/services/planService";

const bodySchema = z.object({ status: z.enum(["used", "not_used", "proposed"]) }).strict();

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const id = uuidParam.parse((await ctx.params).id);
  const { status } = bodySchema.parse(await readJson(req));
  return NextResponse.json(await setSuggestionStatus(userId, id, status));
});
