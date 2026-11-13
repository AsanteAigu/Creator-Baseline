import { serverEnv } from "@/lib/config";
import { decryptToken, encryptToken } from "@/lib/instagram/crypto";
import { tokenKey } from "@/lib/instagram/keys";
import { InstagramError, type InstagramSource } from "@/lib/instagram/types";
import { asSystem, withRepos } from "@/lib/repositories";

/**
 * Long-lived tokens last about 60 days. A run that starts inside this window refreshes
 * them, so a creator synced at least once a week never lapses. There is no separate cron
 * for this in Phase 5; the ingest path is the schedule (D-027).
 */
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Below this, a failed refresh means the token may expire before the next run. */
const MIN_USEFUL_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Decrypts the creator's token and refreshes it when it is close to expiry. Returns null
 * for fixture creators (no token) in mock mode. Any unrecoverable problem marks the creator
 * `needs_reauth` and throws `AUTH`, which the pipeline records on the run.
 */
export async function resolveAccessToken(
  creatorId: string,
  source: InstagramSource,
  now: Date,
): Promise<string | null> {
  const material = await withRepos(asSystem(), (r) => r.creators.getTokenMaterial(creatorId));
  if (material === null) {
    // Fixture creators have no token by design (D-005); a real account without one is broken.
    if (serverEnv().INSTAGRAM_SOURCE === "mock") return null;
    await markNeedsReauth(creatorId);
    throw new InstagramError("This account needs reconnecting.", "AUTH", false);
  }

  const key = tokenKey();
  if (key === null) {
    await markNeedsReauth(creatorId);
    throw new InstagramError("This account needs reconnecting.", "AUTH", false);
  }

  let token: string;
  try {
    token = decryptToken(material, key);
  } catch {
    // Wrong key or a tampered row: only a fresh login can fix this.
    await markNeedsReauth(creatorId);
    throw new InstagramError("This account needs reconnecting.", "AUTH", false);
  }

  const expiresAt = material.expiresAt;
  if (expiresAt === null || expiresAt.getTime() - now.getTime() > REFRESH_WINDOW_MS) return token;

  try {
    const refreshed = await source.refreshToken(token);
    const encrypted = encryptToken(refreshed.token, key);
    await withRepos(asSystem(), (r) =>
      r.creators.setToken(creatorId, encrypted.ciphertext, encrypted.iv, refreshed.expiresAt),
    );
    return refreshed.token;
  } catch (err) {
    const stillUsable = expiresAt.getTime() - now.getTime() > MIN_USEFUL_LIFETIME_MS;
    const authFailure = err instanceof InstagramError && err.code === "AUTH";
    if (stillUsable && !authFailure) {
      // A transient refresh failure must not take a working account offline.
      return token;
    }
    await markNeedsReauth(creatorId);
    throw new InstagramError("This account needs reconnecting.", "AUTH", false);
  }
}

/** System scope: this is bookkeeping on an account, not a user-facing edit. */
export async function markNeedsReauth(creatorId: string): Promise<void> {
  await withRepos(asSystem(), (r) => r.creators.setStatus(creatorId, "needs_reauth"));
}
