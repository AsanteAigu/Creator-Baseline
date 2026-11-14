import { fixtureComments } from "@/lib/fixtures/comments";
import {
  FIXTURE_CREATORS,
  generateCreatorPosts,
  type FixtureCreator,
  type FixturePost,
} from "@/lib/fixtures/creators";
import {
  InstagramError,
  type AccountHint,
  type ConnectedAccount,
  type InstagramCreator,
  type InstagramSource,
  type RawMedia,
} from "./types";

const TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export interface MockSourceOptions {
  /** Makes every data call fail; used by tests and the failure demo. */
  failWith?: InstagramError;
  /** Where the fake login "returns" to: the real callback route, so both modes share it. */
  redirectUri?: string;
}

/**
 * Fixture-backed Instagram. Selected when INSTAGRAM_SOURCE=mock.
 *
 * Posts are anchored to the creator's `connected_at`, so they keep stable timestamps across
 * runs (re-running a window yields identical data) while still looking recent after a reseed.
 */
export class MockInstagramSource implements InstagramSource {
  constructor(private readonly options: MockSourceOptions = {}) {}

  async listRecentMedia(creator: InstagramCreator, since: Date): Promise<RawMedia[]> {
    const posts = this.postsFor(creator);
    return posts
      .filter((p) => p.postedAt >= since)
      .map((p) => ({
        id: p.igMediaId,
        mediaType: p.format === "reel" ? "VIDEO" : p.format === "carousel" ? "CAROUSEL_ALBUM" : "IMAGE",
        mediaProductType: p.format === "reel" ? "REELS" : "FEED",
        permalink: p.permalink,
        timestamp: p.postedAt,
        caption: p.captionExcerpt,
        durationMs: p.durationMs,
      }));
  }

  async getMediaInsights(creator: InstagramCreator, media: RawMedia) {
    const post = this.find(creator, media.id);
    return { ...post.metrics };
  }

  async listComments(creator: InstagramCreator, mediaId: string, limit: number) {
    const post = this.find(creator, mediaId);
    const fixture = this.fixtureFor(creator);
    // Up to 40 per post is plenty to exercise sampling and dedupe.
    const count = Math.min(limit, post.metrics.comments, 40);
    return fixtureComments(fixture.niche, mediaId, count).map((text) => ({ text }));
  }

  /** Skips Meta entirely: the "code" is the fixture key, so the callback picks that account. */
  authorizationUrl(state: string, loginHint?: string): string {
    const url = new URL(this.options.redirectUri ?? "http://localhost:3000/api/creators/callback");
    url.searchParams.set("code", loginHint ?? FIXTURE_CREATORS[0]?.key ?? "");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string, _hint?: AccountHint): Promise<ConnectedAccount> {
    const fixture = FIXTURE_CREATORS.find((f) => f.key === code);
    if (!fixture) throw new InstagramError("That demo account doesn't exist.", "PERMANENT", false);
    return {
      token: `mock-token-${fixture.key}`,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      igUserId: fixture.igUserId,
      username: fixture.username,
      displayName: fixture.displayName,
      avatarUrl: null,
    };
  }

  async refreshToken(token: string) {
    return { token, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) };
  }

  /** Fixture tokens exist only in this database, so there is nothing at Meta to revoke. */
  async revokeToken(): Promise<void> {}

  private fixtureFor(creator: InstagramCreator): FixtureCreator {
    this.maybeFail();
    const fixture = FIXTURE_CREATORS.find((f) => f.igUserId === creator.igUserId);
    if (!fixture) {
      throw new InstagramError("This account is not part of the demo data.", "PERMANENT", false);
    }
    return fixture;
  }

  private postsFor(creator: InstagramCreator): FixturePost[] {
    return generateCreatorPosts(this.fixtureFor(creator), creator.connectedAt);
  }

  private find(creator: InstagramCreator, mediaId: string): FixturePost {
    const post = this.postsFor(creator).find((p) => p.igMediaId === mediaId);
    if (!post) throw new InstagramError("That post is no longer available.", "PERMANENT", false);
    return post;
  }

  private maybeFail(): void {
    if (this.options.failWith) throw this.options.failWith;
  }
}
