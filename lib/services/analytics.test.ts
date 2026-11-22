import { describe, expect, it } from "vitest";
import type { PostView } from "@/lib/repositories";
import { buildAccountAnalytics, compareValues, median, summarisePeriod } from "./analytics";

const NOW = new Date("2026-11-22T12:00:00Z"); // a Sunday
const DAY = 24 * 60 * 60 * 1000;

function post(daysAgo: number, overrides: Partial<PostView> = {}): PostView {
  return {
    id: `p${daysAgo}-${Math.random()}`,
    igMediaId: "m",
    format: "reel",
    permalink: null,
    postedAt: new Date(NOW.getTime() - daysAgo * DAY),
    captionExcerpt: null,
    reach: 1000,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    videoViews: null,
    avgWatchTimeMs: null,
    score: 1,
    label: "normal",
    rValues: {},
    ...overrides,
  };
}

describe("median", () => {
  it("handles empty, odd and even inputs", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("summarisePeriod", () => {
  it("averages only scored posts and counts strong share among them", () => {
    const s = summarisePeriod([
      post(1, { score: 2, label: "strong" }),
      post(2, { score: 1, label: "normal" }),
      post(3, { score: null, label: "too_early", reach: null }),
    ]);
    expect(s.posts).toBe(3);
    expect(s.scored).toBe(2);
    expect(s.averageScore).toBe(1.5);
    expect(s.strongShare).toBe(0.5);
    expect(s.totalReach).toBe(2000);
  });

  it("returns nulls rather than zeros when nothing is scored", () => {
    const s = summarisePeriod([]);
    expect(s.averageScore).toBeNull();
    expect(s.strongShare).toBeNull();
    expect(s.medianReach).toBeNull();
  });
});

describe("buildAccountAnalytics", () => {
  it("splits the current and previous 28 days", () => {
    const a = buildAccountAnalytics([post(1), post(10), post(30), post(40), post(70)], NOW);
    expect(a.current.posts).toBe(2);
    expect(a.previous.posts).toBe(2);
  });

  it("groups by London weekday, Monday first", () => {
    // 2026-11-16 is a Monday.
    const monday = { postedAt: new Date("2026-11-16T09:00:00Z") };
    const a = buildAccountAnalytics([post(0, monday)], NOW);
    expect(a.byWeekday.map((d) => d.key)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(a.byWeekday[0]?.posts).toBe(1);
  });

  it("returns 12 weekly reach buckets ending this week", () => {
    const a = buildAccountAnalytics([post(0, { reach: 500 })], NOW);
    expect(a.weeklyReach).toHaveLength(12);
    expect(a.weeklyReach[11]).toMatchObject({ weekStart: "2026-11-16", reach: 500, posts: 1 });
  });

  it("omits formats with no posts", () => {
    const a = buildAccountAnalytics([post(1, { format: "carousel" })], NOW);
    expect(a.byFormat.map((g) => g.key)).toEqual(["carousel"]);
  });
});

describe("compareValues", () => {
  it("reports direction and relative change", () => {
    expect(compareValues(120, 100)).toEqual({ direction: "up", relative: 0.2, absolute: 20 });
    expect(compareValues(100, 100).direction).toBe("flat");
    expect(compareValues(null, 100).relative).toBeNull();
  });
});
