import { serverEnv } from "@/lib/config";
import { derivedTokenKey, parseKey, stateSigningKey } from "./crypto";

/**
 * The configured key, or a development key derived from SESSION_SECRET in local mock mode so
 * "copy .env.local and connect a demo account" works without generating another secret.
 * Null when neither exists, which lib/config only allows in mock mode outside production.
 */
export function tokenKey(): Buffer | null {
  const env = serverEnv();
  if (env.TOKEN_ENCRYPTION_KEY !== undefined) return parseKey(env.TOKEN_ENCRYPTION_KEY);
  if (env.INSTAGRAM_SOURCE === "mock" && env.SESSION_SECRET !== undefined) {
    return derivedTokenKey(Buffer.from(env.SESSION_SECRET, "utf8"));
  }
  return null;
}

/**
 * Signs the OAuth state cookie. Local mock-mode development may run without an encryption
 * key, so it falls back to the local session secret there; production always has the key.
 */
export function stateKey(): Buffer {
  const env = serverEnv();
  if (env.TOKEN_ENCRYPTION_KEY !== undefined) return stateSigningKey(parseKey(env.TOKEN_ENCRYPTION_KEY));
  if (env.SESSION_SECRET !== undefined) return stateSigningKey(Buffer.from(env.SESSION_SECRET, "utf8"));
  throw new Error("TOKEN_ENCRYPTION_KEY is required to connect accounts");
}
