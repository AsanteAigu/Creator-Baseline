import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { handle, readJson, requireUserId, uuidParam } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rateLimit";
import { replaceUsedSuggestion, setSuggestionStatus, type Replacement } from "@/lib/services/planService";

const bodySchema = z.object({ status: z.enum(["used", "not_used", "proposed"]) }).strict();

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const id = uuidParam.parse((await ctx.params).id);
  const { status } = bodySchema.parse(await readJson(req));
  const updated = await setSuggestionStatus(userId, id, status);

  // Marking used writes a new idea for that day (D-047). The mark is saved either way.
  let outcome: Replacement = { replacement: null, note: null };
  if (status === "used") {
    try {
      await enforceRateLimit(`replace:${userId}`, 10, 600);
      outcome = await replaceUsedSuggestion(userId, id);
    } catch (err) {
      if (!(err instanceof AppError && err.code === "RATE_LIMITED")) throw err;
      outcome = { replacement: null, note: "rate_limited" };
    }
  }
  return NextResponse.json({ ...updated, ...outcome });
});
