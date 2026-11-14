import {
  GRAPH_API_VERSION,
  GRAPH_HOST,
  INSTAGRAM_API_HOST,
  INSTAGRAM_GRAPH_HOST,
  GraphClient,
} from "./graph-client";
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
 * Real Instagram adapter supporting both Direct Instagram Login (no Facebook Page needed)
 * and legacy Facebook Login.
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
  /** Which Meta login the app uses (D-037, D-038). Defaults to "unified". */
  loginType?: "unified" | "instagram" | "facebook";
  /** Facebook Login for Business configuration; when set it replaces scope (D-028). */
  loginConfigId?: string;
  /** Injected in tests. */
  client?: GraphClient;
}

/**
 * Scopes for direct Instagram Login (no Facebook Page needed).
 */
export const INSTAGRAM_OAUTH_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_insights",
  "instagram_business_manage_comments",
] as const;

/**
 * Requested via the dialog when no configuration id is set (Facebook Login). `pages_read_engagement` is
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
    // Only Instagram Login talks to graph.instagram.com; the other two use graph.facebook.com.
    const defaultHost = config.loginType === "instagram" ? INSTAGRAM_GRAPH_HOST : GRAPH_HOST;
    this.client = config.client ?? new GraphClient({ host: defaultHost });
  }

  private get loginType(): "unified" | "instagram" | "facebook" {
    return this.config.loginType ?? "unified";
  }

  authorizationUrl(state: string): string {
    if (this.loginType === "unified") {
      if (this.config.loginConfigId === undefined) {
        throw new InstagramError("Instagram connection is not configured.", "PERMANENT", false);
      }
      const url = new URL(`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`);
      url.searchParams.set("client_id", this.config.appId);
      url.searchParams.set("config_id", this.config.loginConfigId);
      url.searchParams.set("redirect_uri", this.config.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("state", state);
      return url.toString();
    }
    if (this.loginType === "facebook") {
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

    // Direct Instagram Login (no Facebook Page needed)
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("enable_fb_login", "0");
    url.searchParams.set("force_authentication", "1");
    url.searchParams.set("client_id", this.config.appId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", INSTAGRAM_OAUTH_SCOPES.join(","));
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<ConnectedAccount> {
    if (this.loginType === "unified") return this.exchangeUnified(code);
    if (this.loginType === "facebook") {
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
      const longLived = await this.exchangeFacebook(shortToken);
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

    // Direct Instagram Login:
    // 1. Exchange authorization code for short-lived token via POST to api.instagram.com
    const shortLived = await this.client.postForm(
      `${INSTAGRAM_API_HOST}/oauth/access_token`,
      {
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
        code,
      },
    );
    // The user_id here is app-scoped, not the account id the media endpoints take, so it is
    // ignored; the account id comes from /me below.
    const shortToken = stringField(unwrapData(shortLived), "access_token");
    if (shortToken === null) {
      throw new InstagramError("Instagram did not return an access token.", "PERMANENT", false);
    }

    // 2. Exchange short-lived token for long-lived 60-day token
    const longLived = await this.exchangeInstagram(shortToken);
    const token = longLived.token;
    const expiresAt = new Date(Date.now() + longLived.expiresInSeconds * 1000);

    // 3. Directly get Instagram profile details (no Facebook Page needed)
    const me = await this.client.get(
      "/me",
      { fields: "id,user_id,username,name,profile_picture_url" },
      token,
    );
    const meRec = unwrapData(me);
    // `user_id` is the professional account id that /{ig-user-id}/media expects; `id` is
    // app-scoped and would make every later call fail, so there is no fallback to it.
    const igUserId = stringField(meRec, "user_id");
    const username = stringField(meRec, "username");
    if (igUserId === null || username === null) {
      throw new InstagramError("Could not retrieve Instagram user details.", "PERMANENT", false);
    }
    return {
      token,
      expiresAt,
      igUserId,
      username,
      displayName: stringField(meRec, "name"),
      avatarUrl: stringField(meRec, "profile_picture_url"),
    };
  }

  async refreshToken(token: string): Promise<{ token: string; expiresAt: Date }> {
    if (this.loginType === "unified") {
      // Only reached if Meta issued an expiring token (the configuration should say "Never").
      // Extending one needs the token-management API and business_management, which v1 does
      // not request, so the client reconnects instead (D-038).
      throw new InstagramError("This Instagram connection has expired. Reconnect the account.", "AUTH", false);
    }
    const refreshed =
      this.loginType === "facebook" ? await this.exchangeFacebook(token) : await this.refreshInstagram(token);
    return {
      token: refreshed.token,
      expiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
    };
  }

  /**
   * Disconnect: removes this app's permissions for the user token at Meta (§11).
   * Instagram Login documents no revoke endpoint, so there the purge deleting our only copy
   * of the token is the revocation, and the token lapses at Meta within 60 days (D-037).
   */
  async revokeToken(token: string): Promise<void> {
    if (this.loginType !== "facebook") return;
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

  /**
   * Unified Login (D-038): the code becomes a business-integration system-user token for the
   * client's business portfolio. No Page is involved; the shared Instagram accounts are listed
   * from the token itself.
   */
  private async exchangeUnified(code: string): Promise<ConnectedAccount> {
    const body = await this.client.get(
      "/oauth/access_token",
      { client_id: this.config.appId, client_secret: this.config.appSecret, redirect_uri: this.config.redirectUri, code },
      null,
    );
    const rec = unwrapData(body);
    const token = stringField(rec, "access_token");
    if (token === null) {
      throw new InstagramError("Instagram did not return an access token.", "PERMANENT", false);
    }
    const expiresIn = numberField(rec, "expires_in");
    const expiresAt = expiresIn !== null && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;

    const accounts = await this.getPaged<Record<string, unknown>>(
      "/me/assigned_instagram_accounts",
      { fields: "id,username,name,profile_picture_url", limit: String(PAGE_SIZE) },
      token,
    );
    const usable = accounts.filter((a) => stringField(a, "id") !== null && stringField(a, "username") !== null);
    // One connection is one creator. A token covering several accounts would make every
    // creator share one token and one disconnect, so ask for one account per connection.
    if (usable.length === 0) {
      throw new InstagramError("No Instagram professional account was shared during login.", "PERMANENT", false);
    }
    if (usable.length > 1) {
      throw new InstagramError("Share exactly one Instagram account when connecting, then try again.", "PERMANENT", false);
    }
    const account = usable[0]!;
    return {
      token,
      expiresAt,
      igUserId: stringField(account, "id")!,
      username: stringField(account, "username")!,
      displayName: stringField(account, "name"),
      avatarUrl: stringField(account, "profile_picture_url"),
    };
  }

  private async exchangeFacebook(token: string): Promise<{ token: string; expiresInSeconds: number }> {
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

  /**
   * Meta documents this exchange and the refresh below only as GETs with the token in the
   * query string, so these two calls are the one exception to "tokens never in a URL" (D-037).
   * The URL goes server-to-server over TLS and is never logged or returned.
   */
  private async exchangeInstagram(token: string): Promise<{ token: string; expiresInSeconds: number }> {
    const body = await this.client.get(
      `${INSTAGRAM_GRAPH_HOST}/access_token`,
      {
        grant_type: "ig_exchange_token",
        client_secret: this.config.appSecret,
        access_token: token,
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

  private async refreshInstagram(token: string): Promise<{ token: string; expiresInSeconds: number }> {
    const body = await this.client.get(
      `${INSTAGRAM_GRAPH_HOST}/refresh_access_token`,
      {
        grant_type: "ig_refresh_token",
        access_token: token,
      },
      null,
    );
    const next = stringField(record(body), "access_token");
    if (next === null) {
      throw new InstagramError("Instagram did not return a refreshed access token.", "PERMANENT", false);
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

/** Meta's Instagram Login docs show some responses wrapped as `{ data: [ {...} ] }`; accept both. */
function unwrapData(value: unknown): Record<string, unknown> | null {
  const rec = record(value);
  const data = rec?.data;
  return Array.isArray(data) ? record(data[0]) : rec;
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
