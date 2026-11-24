import { describe, expect, it } from "vitest";
import type { PostView } from "@/lib/repositories";
import { isRepeat, normaliseTitle, trackUsedIdeas, verdictFor, type UsedIdea } from "./planTracking";

const NOW = new Date("2026-11-24T12:00:00Z");

function post(id: string, isoDay: string, overrides: Partial<PostView> = {}): PostView {
  return {
    id,
    igMediaId: id,
    format: "reel",
    permalink: null,
    postedAt: new Date(`${isoDay}T18:00:00Z`),
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

function idea(id: string, suggestedDate: string, decided: string, overrides: Partial<UsedIdea> = {}): UsedIdea {
  return { id, title: id, format: "reel", suggestedDate, decidedAt: new Date(`${decided}T09:00:00Z`), ...overrides };
}

describe("trackUsedIdeas", () => {
  it("matches the same-format post closest to the planned day", () => {
    const t = trackUsedIdeas(
      [idea("a", "2026-11-10", "2026-11-10")],
      [post("far", "2026-11-14", { score: 2 }), post("near", "2026-11-11", { score: 1.5 }), post("img", "2026-11-10", { format: "image" })],
      NOW,
    );
    expect(t.ideas[0]?.outcome).toMatchObject({ state: "scored", post: { id: "near", score: 1.5 } });
  });

  it("does not let two ideas claim one post; the earlier decision keeps it", () => {
    const t = trackUsedIdeas(
      [idea("late", "2026-11-11", "2026-11-11"), idea("early", "2026-11-11", "2026-11-09")],
      [post("only", "2026-11-11")],
      NOW,
    );
    const byId = Object.fromEntries(t.ideas.map((i) => [i.id, i.outcome.state]));
    expect(byId).toEqual({ late: "not_posted", early: "scored" });
  });

  it("waits inside the window, then gives up", () => {
    const waiting = trackUsedIdeas([idea("a", "2026-11-23", "2026-11-23")], [], NOW);
    expect(waiting.ideas[0]?.outcome).toEqual({ state: "waiting", until: "2026-11-30" });
    const gone = trackUsedIdeas([idea("a", "2026-11-01", "2026-11-01")], [], NOW);
    expect(gone.ideas[0]?.outcome).toEqual({ state: "not_posted" });
  });

  it("reports a matched post that has no score yet as scoring", () => {
    const t = trackUsedIdeas([idea("a", "2026-11-23", "2026-11-23")], [post("p", "2026-11-23", { score: null, label: null })], NOW);
    expect(t.ideas[0]?.outcome.state).toBe("scoring");
    expect(t.postedCount).toBe(1);
    expect(t.scoredCount).toBe(0);
    expect(t.verdict).toBe("too_early");
  });

  it("averages plan posts against the creator's other posts over the same span", () => {
    const t = trackUsedIdeas(
      [idea("a", "2026-11-10", "2026-11-10"), idea("b", "2026-11-12", "2026-11-12")],
      [
        post("pa", "2026-11-10", { score: 1.5, label: "strong" }),
        post("pb", "2026-11-12", { score: 1.1 }),
        post("other", "2026-11-11", { format: "image", score: 0.8 }),
        post("before", "2026-10-01", { format: "image", score: 3 }),
      ],
      NOW,
    );
    expect(t.planAverage).toBeCloseTo(1.3);
    expect(t.otherAverage).toBeCloseTo(0.8);
    expect(t.strongCount).toBe(1);
    expect(t.verdict).toBe("working");
  });
});

describe("verdictFor", () => {
  it("needs enough scored posts", () => {
    expect(verdictFor(2, 1, 1)).toBe("too_early");
  });
  it("splits working, mixed and not working", () => {
    expect(verdictFor(1.2, 1.0, 3)).toBe("working");
    expect(verdictFor(1.2, 1.4, 3)).toBe("mixed");
    expect(verdictFor(0.8, 0.7, 3)).toBe("mixed");
    expect(verdictFor(0.8, 1.1, 3)).toBe("not_working");
  });
});

describe("repeat detection", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(normaliseTitle("  Garlic   Noodles!! ")).toBe("garlic noodles");
    expect(isRepeat("garlic noodles", ["Garlic Noodles!"])).toBe(true);
    expect(isRepeat("Garlic noodles, part two", ["Garlic Noodles"])).toBe(false);
  });
});
