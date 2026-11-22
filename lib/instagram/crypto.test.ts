import { describe, expect, it } from "vitest";
import {
  decryptToken,
  derivedTokenKey,
  encryptToken,
  newNonce,
  parseKey,
  sameNonce,
  signState,
  stateSigningKey,
  verifyState,
  type OAuthState,
} from "./crypto";

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const SIGNING_KEY = stateSigningKey(KEY);
const NOW_S = 1_800_000_000;

describe("parseKey", () => {
  it("accepts exactly 32 base64-encoded bytes", () => {
    expect(parseKey(KEY.toString("base64"))).toEqual(KEY);
  });

  it("rejects the wrong length", () => {
    expect(() => parseKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("derived development key", () => {
  it("is 32 bytes, deterministic, and separate from the state-signing key", () => {
    const secret = Buffer.from("a-local-session-secret-of-32-chars!!", "utf8");
    const key = derivedTokenKey(secret);

    expect(key).toHaveLength(32);
    expect(derivedTokenKey(secret)).toEqual(key);
    expect(key).not.toEqual(stateSigningKey(secret));
  });
});

describe("token encryption", () => {
  it("round-trips a token", () => {
    const enc = encryptToken("EAAG-secret-token", KEY);
    expect(enc.ciphertext).not.toContain("EAAG");
    expect(decryptToken(enc, KEY)).toBe("EAAG-secret-token");
  });

  it("uses a fresh IV each time", () => {
    const a = encryptToken("same", KEY);
    const b = encryptToken("same", KEY);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails on the wrong key", () => {
    const enc = encryptToken("token", KEY);
    expect(() => decryptToken(enc, OTHER_KEY)).toThrow(/could not be decrypted/);
  });

  it("fails on a tampered ciphertext", () => {
    const enc = encryptToken("token", KEY);
    const bytes = Buffer.from(enc.ciphertext, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(() => decryptToken({ ...enc, ciphertext: bytes.toString("base64") }, KEY)).toThrow(/could not be decrypted/);
  });

  it("rejects malformed stored material", () => {
    expect(() => decryptToken({ ciphertext: "AAAA", iv: "AAAA" }, KEY)).toThrow(/malformed/);
  });
});

describe("OAuth state", () => {
  const state: OAuthState = {
    nonce: "nonce-1",
    userId: "user-1",
    workspaceId: "ws-1",
    exp: NOW_S + 600,
  };

  it("round-trips", () => {
    expect(verifyState(signState(state, SIGNING_KEY), SIGNING_KEY, NOW_S)).toEqual(state);
  });

  it("keeps a reconnect's creator id", () => {
    const withCreator = { ...state, creatorId: "creator-1" };
    expect(verifyState(signState(withCreator, SIGNING_KEY), SIGNING_KEY, NOW_S)).toEqual(withCreator);
  });

  it("rejects a forged or edited payload", () => {
    const signed = signState(state, SIGNING_KEY);
    const [payload, sig] = signed.split(".");
    const edited = Buffer.from(JSON.stringify({ ...state, workspaceId: "ws-2" })).toString("base64url");
    expect(verifyState(`${edited}.${sig}`, SIGNING_KEY, NOW_S)).toBeNull();
    expect(verifyState(`${payload}.${sig}x`, SIGNING_KEY, NOW_S)).toBeNull();
    expect(verifyState(signed, stateSigningKey(OTHER_KEY), NOW_S)).toBeNull();
  });

  it("rejects expiry and nonsense", () => {
    expect(verifyState(signState({ ...state, exp: NOW_S - 1 }, SIGNING_KEY), SIGNING_KEY, NOW_S)).toBeNull();
    expect(verifyState("", SIGNING_KEY, NOW_S)).toBeNull();
    expect(verifyState("a.b", SIGNING_KEY, NOW_S)).toBeNull();
    expect(
      verifyState(
        `${Buffer.from(JSON.stringify({ ...state, creatorId: 4 })).toString("base64url")}.${signState(state, SIGNING_KEY).split(".")[1]}`,
        SIGNING_KEY,
        NOW_S,
      ),
    ).toBeNull();
  });

  it("compares nonces in constant time", () => {
    expect(sameNonce("abc", "abc")).toBe(true);
    expect(sameNonce("abc", "abd")).toBe(false);
    expect(sameNonce("abc", "abcd")).toBe(false);
    expect(newNonce()).not.toBe(newNonce());
  });
});
