import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";
import {
  OAUTH_STATE_COOKIE,
  sameNonce,
  verifyState,
} from "@/lib/instagram/crypto";
import { createInstagramSource } from "@/lib/instagram/factory";
import { stateKey } from "@/lib/instagram/keys";
import { completeConnection } from "@/lib/services/connectionService";

/**
 * GET /api/creators/callback?code=…&state=…
 *
 * Meta's redirect target. The code is exchanged server-side; the token never touches the
 * URL we redirect to. Failures come back as a coarse reason the dashboard can explain
 * without echoing anything Meta said.
 */
export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);

  const finish = (path: string): NextResponse => {
    const res = NextResponse.redirect(new URL(path, serverEnv().APP_BASE_URL));
    // One login per state: clear it whatever the outcome.
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/creators", maxAge: 0 });
    return res;
  };

  const store = await cookies();
  const cookie = store.get(OAUTH_STATE_COOKIE)?.value;
  const echoedState = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  // The user pressed Cancel/Not now on Facebook's dialog.
  if (url.searchParams.get("error") !== null) return finish("/dashboard?connect=denied");
  if (cookie === undefined || echoedState === null || code === null) {
    return finish("/dashboard?connect=state");
  }

  const state = verifyState(cookie, stateKey(), Math.floor(Date.now() / 1000));
  if (state === null || !sameNonce(state.nonce, echoedState)) {
    return finish("/dashboard?connect=state");
  }

  try {
    const account = await createInstagramSource().exchangeCode(code);
    const { creatorId } = await completeConnection(
      state.userId,
      state.workspaceId,
      account,
      state.creatorId,
    );
    return finish(`/accounts/${creatorId}?connected=1`);
  } catch (err) {
    // Class of failure only: messages can carry API detail, never a token.
    console.error(`[oauth] connection failed: ${err instanceof Error ? err.name : "unknown"}`);
    const reason =
      err instanceof AppError && err.code === "CONFLICT"
        ? "mismatch"
        : err instanceof AppError && err.code === "FORBIDDEN"
          ? "forbidden"
          : "failed";
    return finish(`/dashboard?connect=${reason}`);
  }
});
