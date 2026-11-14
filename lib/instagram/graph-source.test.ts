import { describe, expect, it } from "vitest";
import { GraphClient } from "./graph-client";
import {
  GraphInstagramSource,
  INSTAGRAM_OAUTH_SCOPES,
  OAUTH_SCOPES,
} from "./graph-source";
import type { InstagramCreator, RawMedia } from "./types";

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler): typeof fetch {
  return async (input, init) => {
    const url =
      input instanceof URL ? input : typeof input === "string" ? new URL(input) : new URL(input.url);
    return handler(url, init);
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CONFIG = {
  appId: "app-1",
  appSecret: "secret-1",
  redirectUri: "https://app.example/api/creators/callback",
};

function sourceWith(
  handler: Handler,
  loginConfigId?: string,
  loginType: "instagram" | "facebook" = "facebook",
): GraphInstagramSource {
  const host = loginType === "instagram" ? "https://graph.instagram.com" : "https://graph.facebook.com";
  const client = new GraphClient({ host, fetch: fakeFetch(handler), sleep: async () => {} });
  return new GraphInstagramSource({ ...CONFIG, loginConfigId, loginType, client });
}

const creator: InstagramCreator = {
  id: "creator-1",
  igUserId: "17841400000000101",
  connectedAt: new Date("2026-01-01T00:00:00Z"),
  accessToken: "long-lived-token",
};

function media(overrides: Partial<RawMedia> = {}): RawMedia {
  return {
    id: "m1",
    mediaType: "VIDEO",
    mediaProductType: "REELS",
    permalink: "https://instagram.com/p/m1",
    timestamp: new Date("2026-11-10T09:00:00Z"),
    caption: "A reel",
    durationMs: null,
    ...overrides,
  };
}

describe("authorizationUrl", () => {
  it("asks for the permissions the insight calls need", () => {
    const url = new URL(sourceWith(() => json({})).authorizationUrl("nonce-1"));
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toBe("/v27.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get("state")).toBe("nonce-1");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(OAUTH_SCOPES.join(","));
    expect(url.searchParams.get("scope")).toContain("instagram_manage_insights");
  });

  it("uses a configuration id instead of scopes when one is configured", () => {
    const url = new URL(sourceWith(() => json({}), "cfg-9").authorizationUrl("n"));
    expect(url.searchParams.get("config_id")).toBe("cfg-9");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    expect(url.searchParams.get("scope")).toBeNull();
  });

  it("builds a direct Instagram Login URL without Facebook when loginType is instagram", () => {
    const source = sourceWith(() => json({}), undefined, "instagram");
    const url = new URL(source.authorizationUrl("nonce-ig"));
    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get("state")).toBe("nonce-ig");
    expect(url.searchParams.get("enable_fb_login")).toBe("0");
    expect(url.searchParams.get("scope")).toBe(INSTAGRAM_OAUTH_SCOPES.join(","));
  });
});

describe("exchangeCode (Direct Instagram Login)", () => {
  it("exchanges code and reads profile directly from /me without Facebook Page", async () => {
    const seen: URL[] = [];
    const source = sourceWith((url, init) => {
      seen.push(url);
      if (url.origin === "https://api.instagram.com" && url.pathname.endsWith("/oauth/access_token")) {
        expect(init?.method).toBe("POST");
        // Shape from Meta's docs: wrapped in data[], with an app-scoped user_id we must ignore.
        return json({ data: [{ access_token: "short-ig-tok", user_id: "1020", permissions: "x" }] });
      }
      if (url.origin === "https://graph.instagram.com" && url.pathname.endsWith("/access_token")) {
        expect(url.searchParams.get("grant_type")).toBe("ig_exchange_token");
        expect(url.searchParams.get("access_token")).toBe("short-ig-tok");
        return json({ access_token: "long-ig-tok", expires_in: 5_184_000 });
      }
      if (url.origin === "https://graph.instagram.com" && url.pathname.endsWith("/me")) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer long-ig-tok");
        return json({
          id: "app-scoped-1020",
          user_id: "17841400000000999",
          username: "direct_creator",
          name: "Direct Creator",
          profile_picture_url: "https://cdn.example/pfp.jpg",
        });
      }
      if (url.origin === "https://graph.instagram.com" && url.pathname.endsWith("/refresh_access_token")) {
        return json({ access_token: "refreshed-ig-tok", expires_in: 5_184_000 });
      }
      return json({}, 404);
    }, undefined, "instagram");

    const account = await source.exchangeCode("code-ig");
    expect(account).toMatchObject({
      token: "long-ig-tok",
      igUserId: "17841400000000999",
      username: "direct_creator",
      displayName: "Direct Creator",
      avatarUrl: "https://cdn.example/pfp.jpg",
    });

    const refreshed = await source.refreshToken("long-ig-tok");
    expect(refreshed.token).toBe("refreshed-ig-tok");
  });

  it("refuses an account when /me has no professional account id, rather than using the app-scoped id", async () => {
    const source = sourceWith((url) => {
      if (url.origin === "https://api.instagram.com") return json({ access_token: "short", user_id: "1020" });
      if (url.pathname.endsWith("/access_token")) return json({ access_token: "long", expires_in: 100 });
      if (url.pathname.endsWith("/me")) return json({ id: "app-scoped-1020", username: "direct_creator" });
      return json({}, 404);
    }, undefined, "instagram");
    await expect(source.exchangeCode("code")).rejects.toMatchObject({ code: "PERMANENT" });
  });

  it("does not call a revoke endpoint, because Instagram Login has none", async () => {
    const seen: URL[] = [];
    const source = sourceWith((url) => {
      seen.push(url);
      return json({ success: true });
    }, undefined, "instagram");
    await source.revokeToken("long-ig-tok");
    expect(seen).toHaveLength(0);
  });
});

describe("exchangeCode", () => {
  it("exchanges the code for a long-lived token and finds the Instagram account", async () => {
    const seen: URL[] = [];
    const source = sourceWith((url) => {
      seen.push(url);
      if (url.pathname.endsWith("/oauth/access_token")) {
        const grant = url.searchParams.get("grant_type");
        return grant === "fb_exchange_token"
          ? json({ access_token: "long-token", token_type: "bearer", expires_in: 5_183_944 })
          : json({ access_token: "short-token", expires_in: 3_600 });
      }
      if (url.pathname.endsWith("/me/accounts")) {
        return json({
          data: [
            { id: "page-without-ig", name: "No Instagram" },
            {
              id: "page-1",
              name: "Maya's Page",
              instagram_business_account: {
                id: "17841400000000101",
                username: "maya.cooks.uk",
                name: "Maya Okafor",
                profile_picture_url: "https://cdn.example/avatar.jpg",
              },
            },
          ],
          paging: { next: "https://graph.facebook.com/v27.0/next-page" },
        });
      }
      if (url.pathname.endsWith("/next-page")) return json({ data: [] });
      return json({}, 404);
    });

    const account = await source.exchangeCode("code-123");

    expect(account).toMatchObject({
      token: "long-token",
      igUserId: "17841400000000101",
      username: "maya.cooks.uk",
      displayName: "Maya Okafor",
      avatarUrl: "https://cdn.example/avatar.jpg",
    });
    expect(account.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 59 * 24 * 60 * 60 * 1000);

    const codeCall = seen.find((u) => u.searchParams.get("code") === "code-123");
    expect(codeCall?.searchParams.get("client_secret")).toBe("secret-1");
    expect(codeCall?.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    const refreshCall = seen.find((u) => u.searchParams.get("grant_type") === "fb_exchange_token");
    expect(refreshCall?.searchParams.get("fb_exchange_token")).toBe("short-token");
  });

  it("fails with a readable error when the login has no Instagram business account", async () => {
    const source = sourceWith((url) => {
      if (url.pathname.endsWith("/oauth/access_token")) return json({ access_token: "t", expires_in: 3_600 });
      return json({ data: [{ id: "page-1" }] });
    });

    await expect(source.exchangeCode("code")).rejects.toThrow(/No Instagram business account/);
  });

  it("refreshes a long-lived token in place", async () => {
    const source = sourceWith((url) => {
      expect(url.searchParams.get("grant_type")).toBe("fb_exchange_token");
      expect(url.searchParams.get("fb_exchange_token")).toBe("old-token");
      return json({ access_token: "new-token", expires_in: 5_183_944 });
    });

    const refreshed = await source.refreshToken("old-token");
    expect(refreshed.token).toBe("new-token");
    expect(refreshed.expiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 24 * 60 * 60 * 1000);
  });
});

describe("listRecentMedia", () => {
  it("pages, filters by date and maps our fields", async () => {
    const seen: URL[] = [];
    const source = sourceWith((url, init) => {
      seen.push(url);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer long-lived-token");
      if (url.pathname.endsWith("/media")) {
        return json({
          data: [
            {
              id: "new-reel",
              media_type: "VIDEO",
              media_product_type: "REELS",
              permalink: "https://instagram.com/reel/new",
              timestamp: "2026-11-12T09:00:00+0000",
              caption: "New reel",
            },
          ],
          paging: {
            next: "https://graph.facebook.com/v27.0/next-page?access_token=leak&page=2",
          },
        });
      }
      if (url.pathname.endsWith("/next-page")) {
        return json({
          data: [
            {
              id: "new-image",
              media_type: "IMAGE",
              media_product_type: "FEED",
              permalink: "https://instagram.com/p/new",
              timestamp: "2026-11-11T09:00:00+0000",
            },
            {
              id: "old-carousel",
              media_type: "CAROUSEL_ALBUM",
              media_product_type: "FEED",
              permalink: "https://instagram.com/p/old",
              timestamp: "2026-01-01T09:00:00+0000",
            },
          ],
        });
      }
      return json({}, 404);
    });

    const result = await source.listRecentMedia(creator, new Date("2026-06-01T00:00:00Z"));

    expect(result.map((m) => m.id)).toEqual(["new-reel", "new-image"]);
    expect(result[0]).toMatchObject({ mediaProductType: "REELS", durationMs: null });
    expect(result[1]).toMatchObject({ mediaProductType: "FEED", caption: null });
    expect(seen[0]?.searchParams.get("fields")).toContain("media_product_type");
    expect(seen[1]?.searchParams.get("access_token")).toBeNull();
  });

  it("refuses to call Instagram without a token", async () => {
    const source = sourceWith(() => json({ data: [] }));
    await expect(
      source.listRecentMedia({ ...creator, accessToken: null }, new Date()),
    ).rejects.toMatchObject({ code: "AUTH" });
  });
});

describe("getMediaInsights", () => {
  it("requests Reel watch time for a Reel", async () => {
    let metric = "";
    const source = sourceWith((url) => {
      metric = url.searchParams.get("metric") ?? "";
      return json({
        data: [
          { name: "reach", values: [{ value: 1_000 }] },
          { name: "likes", values: [{ value: 50 }] },
          { name: "comments", values: [{ value: 4 }] },
          { name: "saved", values: [{ value: 12 }] },
          { name: "shares", values: [{ value: 8 }] },
          { name: "ig_reels_avg_watch_time", values: [{ value: 4_321.6 }] },
          { name: "views", values: [{ value: 9_000 }] },
        ],
      });
    });

    const result = await source.getMediaInsights(creator, media());

    expect(metric).toContain("ig_reels_avg_watch_time");
    expect(metric).toContain("views");
    expect(result.avgWatchTimeMs).toBe(4_322);
    expect(result.reach).toBe(1_000);
  });

  it("does not ask for watch time on a photo", async () => {
    let metric = "";
    const source = sourceWith((url) => {
      metric = url.searchParams.get("metric") ?? "";
      return json({
        data: [
          { name: "reach", values: [{ value: 10 }] },
          { name: "likes", values: [{ value: 1 }] },
          { name: "comments", values: [{ value: 0 }] },
          { name: "saved", values: [{ value: 0 }] },
          { name: "shares", values: [{ value: 0 }] },
        ],
      });
    });

    const result = await source.getMediaInsights(
      creator,
      media({ mediaType: "IMAGE", mediaProductType: "FEED" }),
    );
    expect(metric).not.toContain("ig_reels_avg_watch_time");
    expect(result.avgWatchTimeMs).toBeNull();
  });

  it("reports an empty data set as NO_DATA, not as zeros", async () => {
    const source = sourceWith(() => json({ data: [] }));
    await expect(source.getMediaInsights(creator, media())).rejects.toMatchObject({ code: "NO_DATA" });
  });

  it("fails loudly when a metric is missing from a present payload", async () => {
    const source = sourceWith(() =>
      json({
        data: [
          { name: "reach", values: [{ value: 10 }] },
          { name: "likes", values: [{ value: 1 }] },
          { name: "comments", values: [{ value: 0 }] },
          { name: "saved", values: [{ value: 0 }] },
        ],
      }),
    );
    await expect(source.getMediaInsights(creator, media())).rejects.toMatchObject({
      code: "PERMANENT",
    });
  });
});

describe("listComments", () => {
  it("pages up to the limit and drops empty text", async () => {
    let page = 0;
    const source = sourceWith((url) => {
      page++;
      if (page === 1) {
        expect(url.searchParams.get("fields")).toBe("text");
        return json({
          data: [{ text: "first" }, { text: "   " }],
          paging: { next: "https://graph.facebook.com/v27.0/next-comments" },
        });
      }
      return json({ data: [{ text: "second" }, { text: "third" }] });
    });

    const comments = await source.listComments(creator, "m1", 3);
    expect(comments.map((c) => c.text)).toEqual(["first", "second", "third"]);
  });

  it("returns nothing for a zero limit without calling Instagram", async () => {
    let called = false;
    const source = sourceWith(() => {
      called = true;
      return json({ data: [] });
    });
    expect(await source.listComments(creator, "m1", 0)).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("Unified Login", () => {
  it("sends the client to the Facebook dialog with the configuration id", () => {
    const client = new GraphClient({ fetch: fakeFetch(() => json({})), sleep: async () => {} });
    const source = new GraphInstagramSource({ ...CONFIG, loginType: "unified", loginConfigId: "cfg-9", client });
    const url = new URL(source.authorizationUrl("nonce-u"));
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.searchParams.get("config_id")).toBe("cfg-9");
    expect(url.searchParams.get("state")).toBe("nonce-u");
    expect(url.searchParams.get("scope")).toBeNull();
  });

  it("exchanges the code and takes the one shared Instagram account, with a non-expiring token", async () => {
    const source = new GraphInstagramSource({
      ...CONFIG,
      loginType: "unified",
      loginConfigId: "cfg-9",
      client: new GraphClient({
        fetch: fakeFetch((url, init) => {
          expect(url.origin).toBe("https://graph.facebook.com");
          if (url.pathname.endsWith("/oauth/access_token")) return json({ access_token: "suat" });
          if (url.pathname.endsWith("/me/assigned_instagram_accounts")) {
            expect(new Headers(init?.headers).get("authorization")).toBe("Bearer suat");
            return json({ data: [{ id: "17841400000000777", username: "unified_creator", name: "U" }] });
          }
          return json({}, 404);
        }),
        sleep: async () => {},
      }),
    });
    const account = await source.exchangeCode("code-u");
    expect(account).toMatchObject({ token: "suat", igUserId: "17841400000000777", username: "unified_creator", expiresAt: null });
  });

  it("refuses a login that shared several accounts", async () => {
    const source = new GraphInstagramSource({
      ...CONFIG,
      loginType: "unified",
      loginConfigId: "cfg-9",
      client: new GraphClient({
        fetch: fakeFetch((url) =>
          url.pathname.endsWith("/oauth/access_token")
            ? json({ access_token: "suat" })
            : json({ data: [{ id: "1", username: "a" }, { id: "2", username: "b" }] }),
        ),
        sleep: async () => {},
      }),
    });
    await expect(source.exchangeCode("code")).rejects.toMatchObject({ code: "PERMANENT" });
  });
});
