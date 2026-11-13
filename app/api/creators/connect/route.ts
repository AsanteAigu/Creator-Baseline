import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config";
import { handle, requireUserId, uuidParam } from "@/lib/http";
import { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_SECONDS } from "@/lib/instagram/crypto";
import { createInstagramSource } from "@/lib/instagram/factory";
import { beginConnection } from "@/lib/services/connectionService";

/**
 * GET /api/creators/connect[?creatorId=…][&account=…]
 *
 * Starts Facebook Login for Business. The tenant and (for reconnects) the creator live in
 * a signed, HTTP-only cookie; only a random nonce travels through Meta. In mock mode the
 * same route "logs in" a fixture account, optionally chosen with `account` (D-030).
 */
export const GET = handle(async (req: Request) => {
  const userId = await requireUserId();
  const url = new URL(req.url);

  const rawCreatorId = url.searchParams.get("creatorId");
  const creatorId = rawCreatorId === null ? null : uuidParam.parse(rawCreatorId);
  const started = await beginConnection(userId, creatorId);

  const source = createInstagramSource();
  const response = NextResponse.redirect(
    source.authorizationUrl(started.nonce, url.searchParams.get("account") ?? undefined),
  );
  response.cookies.set(OAUTH_STATE_COOKIE, started.signedState, {
    httpOnly: true,
    sameSite: "lax",
    secure: serverEnv().NODE_ENV === "production",
    path: "/api/creators",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  return response;
});
