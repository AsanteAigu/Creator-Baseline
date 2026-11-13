import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { handle, requireUserId, uuidParam } from "@/lib/http";
import { POSTS_PAGE_MAX, listPosts } from "@/lib/services/creatorService";

const querySchema = z.object({
  label: z.enum(["strong", "normal", "weak", "too_early", "baseline_building"]).optional(),
  format: z.enum(["reel", "image", "carousel"]).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(POSTS_PAGE_MAX).default(20),
  cursor: z.string().optional(),
});

/** Opaque cursor: base64url of "postedAtISO|postId". */
function decodeCursor(raw: string | undefined) {
  if (!raw) return null;
  const [postedAt, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const parsed = z.object({ postedAt: z.iso.datetime({ offset: true }), id: z.uuid() }).safeParse({ postedAt, id });
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", "Invalid cursor.", { cursor: "Invalid cursor." });
  return { postedAt: new Date(parsed.data.postedAt), id: parsed.data.id };
}

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const id = uuidParam.parse((await ctx.params).id);
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const page = await listPosts(
    userId,
    id,
    {
      label: q.label,
      format: q.format,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    },
    q.limit,
    decodeCursor(q.cursor),
  );
  const next = page.nextCursor
    ? Buffer.from(`${page.nextCursor.postedAt.toISOString()}|${page.nextCursor.id}`).toString("base64url")
    : null;
  return NextResponse.json({ items: page.items, nextCursor: next });
});
