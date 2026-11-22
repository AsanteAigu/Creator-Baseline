import { describe, expect, it } from "vitest";
import {
  CAPTION_EXCERPT_MAX,
  captionExcerpt,
  insightMetricsFor,
  isScorableMedia,
  mapInsights,
  toPostFormat,
  type GraphInsightEntry,
} from "./metrics";
import { InstagramError } from "./types";

function entries(values: Record<string, number>): GraphInsightEntry[] {
  return Object.entries(values).map(([name, value]) => ({ name, values: [{ value }] }));
}

const FEED_NUMBERS = { reach: 1_000, likes: 50, comments: 4, saved: 12, shares: 8 };

describe("format mapping", () => {
  it("maps Instagram's classification to our three formats", () => {
    expect(toPostFormat({ mediaType: "VIDEO", mediaProductType: "REELS" })).toBe("reel");
    // A feed video is still a video post for scoring, not a Reel.
    expect(toPostFormat({ mediaType: "VIDEO", mediaProductType: "FEED" })).toBe("reel");
    expect(toPostFormat({ mediaType: "CAROUSEL_ALBUM", mediaProductType: "FEED" })).toBe("carousel");
    expect(toPostFormat({ mediaType: "IMAGE", mediaProductType: "FEED" })).toBe("image");
  });

  it("drops stories and ads", () => {
    expect(isScorableMedia({ mediaProductType: "STORY" })).toBe(false);
    expect(isScorableMedia({ mediaProductType: "AD" })).toBe(false);
    expect(isScorableMedia({ mediaProductType: "FEED" })).toBe(true);
    expect(isScorableMedia({ mediaProductType: "REELS" })).toBe(true);
  });
});

describe("caption excerpt", () => {
  it("trims and caps at 300 characters", () => {
    expect(captionExcerpt("  hello  ")).toBe("hello");
    expect(captionExcerpt(null)).toBeNull();
    expect(captionExcerpt("x".repeat(CAPTION_EXCERPT_MAX + 10))).toHaveLength(CAPTION_EXCERPT_MAX);
  });
});

describe("insight metric names", () => {
  it("asks for watch time only on Reels", () => {
    expect(insightMetricsFor({ mediaProductType: "REELS" })).toContain("ig_reels_avg_watch_time");
    expect(insightMetricsFor({ mediaProductType: "REELS" })).toContain("views");
    expect(insightMetricsFor({ mediaProductType: "FEED" })).not.toContain("ig_reels_avg_watch_time");
  });

  it("uses the current names for the shared metrics", () => {
    expect(insightMetricsFor({ mediaProductType: "FEED" })).toEqual(["reach", "likes", "comments", "saved", "shares"]);
  });
});

describe("mapInsights", () => {
  const reel = { id: "m1", mediaProductType: "REELS" } as const;
  const image = { id: "m2", mediaProductType: "FEED" } as const;

  it("maps a Reel including watch time and views", () => {
    const result = mapInsights(reel, entries({ ...FEED_NUMBERS, ig_reels_avg_watch_time: 4_321.6, views: 9_000 }));
    expect(result).toEqual({
      reach: 1_000,
      likes: 50,
      comments: 4,
      saves: 12,
      shares: 8,
      avgWatchTimeMs: 4_322,
      videoViews: 9_000,
    });
  });

  it("leaves watch time null for photos and carousels", () => {
    const result = mapInsights(image, entries(FEED_NUMBERS));
    expect(result.avgWatchTimeMs).toBeNull();
    expect(result.videoViews).toBeNull();
  });

  it("accepts total_value as well as values", () => {
    const result = mapInsights(image, [
      { name: "reach", total_value: { value: 500 } },
      ...entries({ likes: 5, comments: 1, saved: 2, shares: 3 }),
    ]);
    expect(result.reach).toBe(500);
  });

  it("throws when a metric we asked for is missing rather than storing zero", () => {
    const missing = entries(FEED_NUMBERS).filter((e) => e.name !== "saved");
    expect(() => mapInsights(image, missing)).toThrow(InstagramError);
    expect(() => mapInsights(image, missing)).toThrow(/saved/);
  });

  it("treats a zero as a real value", () => {
    const result = mapInsights(image, entries({ ...FEED_NUMBERS, comments: 0 }));
    expect(result.comments).toBe(0);
  });
});
