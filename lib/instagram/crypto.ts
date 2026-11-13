import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Instagram tokens at rest: AES-256-GCM (BUILD_PROMPT §6). The 16-byte auth tag is appended
 * to the ciphertext so the schema needs only the two columns it already has.
 * Nothing in this file logs; error messages never include key, token or ciphertext.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedToken {
  ciphertext: string;
  iv: string;
}

export function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptToken(token: string, key: Buffer): EncryptedToken {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext: body.toString("base64"), iv: iv.toString("base64") };
}

export function decryptToken(enc: EncryptedToken, key: Buffer): string {
  const body = Buffer.from(enc.ciphertext, "base64");
  const iv = Buffer.from(enc.iv, "base64");
  if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) throw new Error("stored token is malformed");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    // GCM authentication failed: wrong key or tampered row.
    throw new Error("stored token could not be decrypted");
  }
}

/**
 * OAuth state, carried in an HTTP-only cookie and echoed back by Meta in `state`.
 * Signed with a key derived from the encryption key, so a separate secret isn't needed and the
 * encryption key itself is never used for two purposes.
 */

export const OAUTH_STATE_COOKIE = "cb_oauth_state";
/** Long enough to finish a Facebook login, short enough to be uninteresting if leaked. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface OAuthState {
  nonce: string;
  userId: string;
  workspaceId: string;
  /** Set when the user is reconnecting an existing creator rather than connecting a new one. */
  creatorId?: string;
  /** Unix seconds. */
  exp: number;
}

export function stateSigningKey(secret: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), "creator-baseline/oauth-state/v1", 32));
}

/**
 * Local mock mode has no TOKEN_ENCRYPTION_KEY, but fixture logins still go through the real
 * encryption path. Deriving from the session secret with a different HKDF label keeps the two
 * uses apart; production and graph mode always use the configured key (D-031).
 */
export function derivedTokenKey(secret: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), "creator-baseline/token-encryption/v1", 32));
}

export function newNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function signState(state: OAuthState, key: Buffer): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const sig = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** Returns null for anything forged, malformed or expired. */
export function verifyState(cookie: string, key: Buffer, nowSec: number): OAuthState | null {
  const [payload, sig] = cookie.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(createHmac("sha256", key).update(payload).digest("base64url"));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const s = parsed as Record<string, unknown>;
  if (
    typeof s.nonce !== "string" ||
    typeof s.userId !== "string" ||
    typeof s.workspaceId !== "string" ||
    typeof s.exp !== "number" ||
    (s.creatorId !== undefined && typeof s.creatorId !== "string")
  ) {
    return null;
  }
  if (s.exp < nowSec) return null;
  return {
    nonce: s.nonce,
    userId: s.userId,
    workspaceId: s.workspaceId,
    ...(s.creatorId !== undefined ? { creatorId: s.creatorId } : {}),
    exp: s.exp,
  };
}

/** Constant-time comparison for the state echoed in the callback URL. */
export function sameNonce(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
