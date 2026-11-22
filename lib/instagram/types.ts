/** What the pipeline needs to know about a creator to talk to Instagram. */
export interface InstagramCreator {
  id: string;
  igUserId: string;
  connectedAt: Date;
  /** Decrypted long-lived token. Null for fixture creators in mock mode. */
  accessToken: string | null;
}

/** Instagram's own media classification, before we map it to our three formats. */
export type RawMediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
export type RawMediaProductType = "FEED" | "REELS" | "STORY" | "AD";

export interface RawMedia {
  id: string;
  mediaType: RawMediaType;
  mediaProductType: RawMediaProductType;
  permalink: string;
  timestamp: Date;
  caption: string | null;
  durationMs: number | null;
}

/** Already mapped to our field names by lib/instagram/metrics.ts. */
export interface RawInsights {
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  avgWatchTimeMs: number | null;
  videoViews: number | null;
}

/**
 * Exists only in memory for the duration of one run. Never persisted, never logged
 * (SPECIFICATION §4/§11): comments are reduced to aggregates before anything is stored.
 */
export interface RawComment {
  text: string;
}

/** What a completed login gives us. The token is the long-lived one, ready to encrypt. */
export interface ConnectedAccount {
  token: string;
  /** Null when the token does not expire (Unified Login system-user token, D-038). */
  expiresAt: Date | null;
  igUserId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  /**
   * Unified Login only: further new accounts shared in the same login. They use the same
   * portfolio token, so connecting them needs no second login (D-044).
   */
  alsoShared?: SharedProfile[];
}

/** An Instagram account's profile, without the token it shares with the login's main account. */
export type SharedProfile = Pick<ConnectedAccount, "igUserId" | "username" | "displayName" | "avatarUrl">;

/**
 * Unified Login hands back one token per business portfolio, covering every Instagram account
 * shared from it, so a second account from the same portfolio arrives alongside the first.
 */
export interface AccountHint {
  /** Accounts this workspace already has: skipped when choosing a new one. */
  knownIgUserIds: string[];
  /** Reconnecting: the account being reconnected. */
  preferIgUserId?: string;
}

export interface InstagramSource {
  listRecentMedia(creator: InstagramCreator, since: Date): Promise<RawMedia[]>;
  /**
   * Takes the whole media item, not just its id: which insight metrics can be requested
   * depends on its product type (REELS-only watch time), and the caller already has it
   * (DECISIONS.md D-026).
   */
  getMediaInsights(creator: InstagramCreator, media: RawMedia): Promise<RawInsights>;
  /** Added beyond the §6 interface: the themes call needs comments (DECISIONS.md D-014). */
  listComments(creator: InstagramCreator, mediaId: string, limit: number): Promise<RawComment[]>;
  /**
   * Where to send the user to grant access. Added beyond §6 so the route stays the same in
   * both modes; `loginHint` lets the mock choose which fixture account "logs in".
   */
  authorizationUrl(state: string, loginHint?: string): string;
  /**
   * Returns the account profile as well as the token (§6 returned only the id; D-027).
   * `hint` picks the account when one login covers several (Unified Login, D-041).
   */
  exchangeCode(code: string, hint?: AccountHint): Promise<ConnectedAccount>;
  refreshToken(token: string): Promise<{ token: string; expiresAt: Date }>;
  /** Disconnect: best-effort revoke of the app's permissions at Meta (§11, D-033). */
  revokeToken(token: string): Promise<void>;
}

/**
 * `retryable` follows §6: 429 and 5xx retry, other 4xx are permanent. The message is safe
 * to show a client; it never contains a token or a raw API body.
 *
 * `NO_DATA` means Instagram has no insights for this post yet (data can be delayed up to
 * 48 hours). The post is skipped for this run and picked up by a later one (D-025).
 */
export class InstagramError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "RATE_LIMITED" | "AUTH" | "PERMANENT" | "NO_DATA",
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "InstagramError";
  }
}
