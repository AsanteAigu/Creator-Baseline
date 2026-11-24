import { describe, expect, it } from "vitest";
import type { PostView } from "@/lib/repositories";
import { buildPlanProfile } from "./planProfile";
import type { TrackedIdea } from "./planTracking";

function post(id: string, isoDay: string, format: PostView["format"], score: number | null): PostView {
  return {
    id,
    igMediaId: id,
    format,
    permalink: null,
    postedAt: new Date(`${isoDay}T12:00:00Z`),
    captionExcerpt: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    videoViews: null,
    avgWatchTimeMs: null,
    score,
    label: score === null ? null : score > 1.5 ? "strong" : score < 0.9 ? "weak" : "normal",
    rValues: {},
  };
}

// 2026-11-02 is a Monday, 2026-11-04 a Wednesday.
const POSTS = [
  post("r1", "2026-11-02", "reel", 1.8),
  post("r2", "2026-11-09", "reel", 1.4),
  post("r3", "2026-11-16", "reel", 1.6),
  post("i1", "2026-11-04", "image", 0.6),
  post("i2", "2026-11-11", "image", 0.7),
  post("i3", "2026-11-18", "image", 0.8),
  post("c1", "2026-11-04", "carousel", null),
];

describe("buildPlanProfile", () => {
  it("ranks formats and weekdays by median score and skips thin or unscored buckets", () => {
    const p = buildPlanProfile(POSTS, []);
    expect(p.formats.map((f) => [f.key, f.median, f.posts])).toEqual([
      ["reel", 1.6, 3],
      ["image", 0.7, 3],
    ]);
    expect(p.formats[0]?.strongShare).toBe(0.67);
    expect(p.weekdays.map((w) => w.key)).toEqual(["Monday", "Wednesday"]);
  });

  it("turns the buckets into guidance", () => {
    const g = buildPlanProfile(POSTS, []).guidance.join(" ");
    expect(g).toContain("Lead with reels: median score 1.60 over 3 posts.");
    expect(g).toContain("Use images sparingly");
    expect(g).toContain("Put the strongest ideas on Monday");
    expect(g).toContain("Keep lighter or experimental ideas for Wednesday");
  });

  it("learns from how earlier plan ideas scored", () => {
    const tracked: TrackedIdea[] = [1.2, 1.3, 1.1].map((score, i) => ({
      id: `t${i}`,
      title: `t${i}`,
      format: "carousel",
      suggestedDate: null,
      decidedAt: new Date("2026-11-01T00:00:00Z"),
      outcome: {
        state: "scored",
        post: { id: `p${i}`, postedAt: new Date(), permalink: null, captionExcerpt: null, reach: null, score, label: "normal" },
      },
    }));
    const p = buildPlanProfile([], tracked);
    expect(p.planIdeas).toEqual([{ key: "carousel", posts: 3, median: 1.2, strongShare: 0 }]);
    expect(p.guidance).toEqual(["Earlier plan carousels worked (median 1.20): more ideas of that kind."]);
  });

  it("says so when there is nothing to learn from yet", () => {
    expect(buildPlanProfile([], []).guidance).toEqual(["Not enough scored posts yet to favour a format or day."]);
  });
});
