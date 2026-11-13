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
 * (BUILD_PROMPT §4/§11): comments are reduced to aggregates before anything is stored.
 */
export interface RawComment {
  text: string;
}

export interface InstagramSource {
  listRecentMedia(creator: InstagramCreator, since: Date): Promise<RawMedia[]>;
  getMediaInsights(creator: InstagramCreator, mediaId: string): Promise<RawInsights>;
  /** Added beyond the §6 interface: the themes call needs comments (DECISIONS.md D-014). */
  listComments(creator: InstagramCreator, mediaId: string, limit: number): Promise<RawComment[]>;
  exchangeCode(code: string): Promise<{ token: string; expiresAt: Date; igUserId: string }>;
  refreshToken(token: string): Promise<{ token: string; expiresAt: Date }>;
}

/**
 * `retryable` follows §6: 429 and 5xx retry, other 4xx are permanent. The message is safe
 * to show a client; it never contains a token or a raw API body.
 */
export class InstagramError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "RATE_LIMITED" | "AUTH" | "PERMANENT",
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "InstagramError";
  }
}
