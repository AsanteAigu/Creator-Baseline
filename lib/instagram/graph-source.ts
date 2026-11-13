import { GRAPH_API_VERSION, GraphClient } from "./graph-client";
import { insightMetricsFor, mapInsights, type GraphInsightEntry } from "./metrics";
import {
  InstagramError,
  type ConnectedAccount,
  type InstagramCreator,
  type InstagramSource,
  type RawComment,
  type RawInsights,
  type RawMedia,
  type RawMediaProductType,
  type RawMediaType,
} from "./types";

/**
 * The real Instagram adapter (Instagram API with Facebook Login).
 *
 * Endpoints and field names were checked against the Instagram Platform reference on
 * 13 Nov 2026 (Graph API v27.0). Instagram returns `media_type`, `media_product_type`,
 * `permalink`, `timestamp`, `caption` on media, and per-media insights by metric name;
 * the Reel watch-time metric is `ig_reels_avg_watch_time` (D-024).
 */

export interface GraphSourceConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  /** Facebook Login for Business configuration; when set it replaces scope (D-028). */
  loginConfigId?: string;
  /** Injected in tests. */
  client?: GraphClient;
}

/**
 * Requested via the dialog when no configuration id is set. `pages_read_engagement` is
 * needed to see the Page behind the Instagram account (D-028).
 */
export const OAUTH_SCOPES = [
  "instagram_basic",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
] as const;

const MEDIA_FIELDS = "id,media_type,media_product_type,permalink,timestamp,caption,thumbnail_url";
const ACCOUNT_FIELDS =
  "id,name,instagram_business_account{id,username,name,profile_picture_url}";
const PAGE_SIZE = 50;
/** Bounds a runaway paging loop. 20 pages holds well over the 120-day lookback. */
const MAX_PAGES = 20;
const COMMENT_PAGE_SIZE = 100;
const DEFAULT_TOKEN_LIFETIME_S = 60 * 24 * 60 * 60;

const MEDIA_TYPES = new Set<RawMediaType>(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]);
const PRODUCT_TYPES = new Set<RawMediaProductType>(["FEED", "REELS", "STORY", "AD"]);

interface Page<T> {
  items: T[];
  next: string | null;
}

export class GraphInstagramSource implements InstagramSource {
  private readonly client: GraphClient;
  private readonly config: GraphSourceConfig;

  constructor(config: GraphSourceConfig) {
    this.config = config;
    this.client = config.client ?? new GraphClient();
  }

  authorizationUrl(state: string): string {
    const url = new URL(`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`);
    url.searchParams.set("client_id", this.config.appId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    if (this.config.loginConfigId !== undefined) {
      url.searchParams.set("config_id", this.config.loginConfigId);
      url.searchParams.set("override_default_response_type", "true");
    } else {
      url.searchParams.set("scope", OAUTH_SCOPES.join(","));
    }
    return url.toString();
  }

  async exchangeCode(code: string): Promise<ConnectedAccount> {
    // 1. Authorization code -> short-lived user token.
    const shortLived = await this.client.get(
      "/oauth/access_token",
      {
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        redirect_uri: this.config.redirectUri,
        code,
      },
      null,
    );
    const shortToken = stringField(record(shortLived), "access_token");
    if (shortToken === null) {
      throw new InstagramError("Instagram did not return an access token.", "PERMANENT", false);
    }

    // 2. Short-lived -> long-lived user token (about 60 days).
    const longLived = await this.exchange(shortToken);
    const token = longLived.token;
    const expiresAt = new Date(Date.now() + longLived.expiresInSeconds * 1000);

    // 3. The Instagram professional account behind the Facebook login.
    const pages = await this.getPaged<Record<string, unknown>>(
      "/me/accounts",
      { fields: ACCOUNT_FIELDS, limit: String(PAGE_SIZE) },
      token,
    );
    for (const page of pages) {
      const ig = record(page.instagram_business_account);
      if (ig === null) continue;
      const igUserId = stringField(ig, "id");
      const username = stringField(ig, "username");
      if (igUserId === null || username === null) continue;
      return {
        token,
        expiresAt,
        igUserId,
        username,
        displayName: stringField(ig, "name"),
        avatarUrl: stringField(ig, "profile_picture_url"),
      };
    }
    throw new InstagramError(
      "No Instagram business account is linked to this Facebook login. Connect the Instagram account to a Facebook Page first.",
      "PERMANENT",
      false,
    );
  }

  async refreshToken(token: string): Promise<{ token: string; expiresAt: Date }> {
    const refreshed = await this.exchange(token);
    return {
      token: refreshed.token,
      expiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
    };
  }

  /** Disconnect: removes this app's permissions for the user token at Meta (§11). */
  async revokeToken(token: string): Promise<void> {
    await this.client.delete("/me/permissions", {}, token);
  }

  async listRecentMedia(creator: InstagramCreator, since: Date): Promise<RawMedia[]> {
    const token = requireToken(creator);
    const items = await this.getPaged<Record<string, unknown>>(
      `/${encodeURIComponent(creator.igUserId)}/media`,
      { fields: MEDIA_FIELDS, limit: String(PAGE_SIZE) },
      token,
    );
    return items.map(toRawMedia).filter((media) => media.timestamp >= since);
  }

  async getMediaInsights(creator: InstagramCreator, media: RawMedia): Promise<RawInsights> {
    const token = requireToken(creator);
    const body = await this.client.get(
      `/${encodeURIComponent(media.id)}/insights`,
      { metric: insightMetricsFor(media).join(",") },
      token,
    );
    const entries = record(body)?.data;
    if (!Array.isArray(entries)) {
      throw new InstagramError("Instagram returned insights in an unexpected shape.", "PERMANENT", false);
    }
    // An empty data set means "not available yet", not "every metric is zero" (D-025).
    if (entries.length === 0) {
      throw new InstagramError("Instagram has no insights for this post yet.", "NO_DATA", false);
    }
    return mapInsights(media, entries.filter(isInsightEntry));
  }

  async listComments(creator: InstagramCreator, mediaId: string, limit: number): Promise<RawComment[]> {
    const token = requireToken(creator);
    const wanted = Math.max(0, limit);
    if (wanted === 0) return [];
    const out: RawComment[] = [];
    let path = `/${encodeURIComponent(mediaId)}/comments`;
    let params: Record<string, string> = {
      fields: "text",
      limit: String(Math.min(wanted, COMMENT_PAGE_SIZE)),
    };
    for (let page = 0; page < MAX_PAGES && out.length < wanted; page++) {
      const body = await this.client.get(path, params, token);
      const parsed = parsePage<Record<string, unknown>>(body);
      for (const item of parsed.items) {
        const text = stringField(item, "text");
        if (text !== null && text.trim() !== "") out.push({ text });
        if (out.length >= wanted) break;
      }
      if (parsed.next === null) break;
      path = parsed.next;
      params = {};
    }
    return out;
  }

  /** Short-lived -> long-lived exchange; also used to extend a long-lived token. */
  private async exchange(token: string): Promise<{ token: string; expiresInSeconds: number }> {
    const body = await this.client.get(
      "/oauth/access_token",
      {
        grant_type: "fb_exchange_token",
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        fb_exchange_token: token,
      },
      null,
    );
    const next = stringField(record(body), "access_token");
    if (next === null) {
      throw new InstagramError("Instagram did not return an access token.", "PERMANENT", false);
    }
    const expiresIn = numberField(record(body), "expires_in");
    return { token: next, expiresInSeconds: expiresIn ?? DEFAULT_TOKEN_LIFETIME_S };
  }

  private async getPaged<T>(path: string, params: Record<string, string>, token: string): Promise<T[]> {
    const out: T[] = [];
    let currentPath = path;
    let currentParams = params;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.client.get(currentPath, currentParams, token);
      const parsed = parsePage<T>(body);
      out.push(...parsed.items);
      if (parsed.next === null) break;
      currentPath = parsed.next;
      currentParams = {};
    }
    return out;
  }
}

function requireToken(creator: InstagramCreator): string {
  if (creator.accessToken === null) {
    throw new InstagramError("This account needs reconnecting.", "AUTH", false);
  }
  return creator.accessToken;
}

function parsePage<T>(body: unknown): Page<T> {
  const root = record(body);
  const data = root?.data;
  if (!Array.isArray(data)) {
    throw new InstagramError("Instagram returned a list in an unexpected shape.", "PERMANENT", false);
  }
  const next = root?.paging !== undefined ? stringField(record(root.paging), "next") : null;
  // `data` comes from JSON, so its entries are objects in practice; callers validate fields.
  return { items: data as T[], next };
}

function toRawMedia(item: Record<string, unknown>): RawMedia {
  const id = stringField(item, "id");
  const mediaType = stringField(item, "media_type");
  const permalink = stringField(item, "permalink");
  const timestamp = stringField(item, "timestamp");
  if (id === null || mediaType === null || !MEDIA_TYPES.has(mediaType as RawMediaType)) {
    throw new InstagramError("Instagram returned a post we could not read.", "PERMANENT", false);
  }
  if (permalink === null || timestamp === null) {
    throw new InstagramError("Instagram returned a post without a link or date.", "PERMANENT", false);
  }
  const postedAt = new Date(timestamp);
  if (Number.isNaN(postedAt.getTime())) {
    throw new InstagramError("Instagram returned a post with an unreadable date.", "PERMANENT", false);
  }
  const product = stringField(item, "media_product_type");
  const mediaProductType: RawMediaProductType =
    product !== null && PRODUCT_TYPES.has(product as RawMediaProductType)
      ? (product as RawMediaProductType)
      : "FEED";
  return {
    id,
    mediaType: mediaType as RawMediaType,
    mediaProductType,
    permalink,
    timestamp: postedAt,
    caption: stringField(item, "caption"),
    // The media reference has no length field; watch time is compared as a raw average
    // against the creator's own median instead (D-024).
    durationMs: null,
  };
}

function isInsightEntry(value: unknown): value is GraphInsightEntry {
  return record(value) !== null && typeof record(value)?.name === "string";
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringField(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function numberField(source: Record<string, unknown> | null, key: string): number | null {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
