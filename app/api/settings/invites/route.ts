import { NextResponse } from "next/server";
import { z } from "zod";
import { serverEnv } from "@/lib/config";
import { handle, readJson, requireUserId } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rateLimit";
import { createInvite, INVITE_ROLES } from "@/lib/services/memberService";

const inviteSchema = z.object({
  email: z.email({ message: "Enter a valid email address." }).max(254),
  role: z.enum(INVITE_ROLES as [string, ...string[]]).transform((r) => r as (typeof INVITE_ROLES)[number]),
});

/**
 * POST /api/settings/invites - owner/admin creates a single-use invite link (D-040).
 * The link is returned once; only its hash is stored.
 */
export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  const input = inviteSchema.parse(await readJson(req));
  await enforceRateLimit(`invite:${userId}`, 30, 3600);
  const { invite, token } = await createInvite(userId, input);
  return NextResponse.json(
    {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      link: new URL(`/invite/${token}`, serverEnv().APP_BASE_URL).toString(),
    },
    { status: 201 },
  );
});
