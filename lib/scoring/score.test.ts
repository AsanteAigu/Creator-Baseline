import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCORING_CONFIG,
  combineScore,
  computeBaseline,
  labelFor,
  roundForStorage,
  scorePost,
  type MetricSnapshot,
  type PostFormat,
  type ScorablePost,
} from "./index";

// Written before the implementation: the requirements doc's worked example (§6).
describe("golden example", () => {
  it("scores 0.35(1.5) + 0.25(1.5) + 0.20(1.0) + 0.10(1.2) + 0.10(0.5) as 1.27", () => {
    const score = combineScore(
      { watch_time: 1.5, sends: 1.5, saves: 1.0, likes: 1.2, comments: 0.5 },
      { watch_time: 0.35, sends: 0.25, saves: 0.2, likes: 0.1, comments: 0.1 },
    );
    expect(score).toBeCloseTo(1.27, 10);
    expect(roundForStorage(score)).toBe(1.27);
  });

  it("produces 1.27 end to end from the worked example's rates", () => {
    // Usual: watch 40%, sends 2%, saves 1.5%, likes 5%, comments 0.4%.
    const usual = rateMetrics({ watch: 0.4, sends: 0.02, saves: 0.015, likes: 0.05, comments: 0.004 });
    const history = Array.from({ length: 10 }, (_, i) => reel(`h${i}`, 48 + i * 24, usual));
    // This post: watch 60%, sends 3%, saves 1.5%, likes 6%, comments 0.2%.
    const post = reel(
      "p",
      48,
      rateMetrics({ watch: 0.6, sends: 0.03, saves: 0.015, likes: 0.06, comments: 0.002 }),
    );

    const result = scorePost(post, [post, ...history], DEFAULT_SCORING_CONFIG, NOW);

    expect(result.label).toBe("normal");
    expect(roundForStorage(result.score ?? 0)).toBe(1.27);
    expect(result.rValues).toEqual({
      watch_time: expect.closeTo(1.5, 10),
      sends: expect.closeTo(1.5, 10),
      saves: expect.closeTo(1.0, 10),
      likes: expect.closeTo(1.2, 10),
      comments: expect.closeTo(0.5, 10),
    });
  });
});

describe("photo weights", () => {
  it("drops watch time and uses sends .40 / saves .30 / likes .15 / comments .15", () => {
    const usual = rateMetrics({ sends: 0.01, saves: 0.01, likes: 0.05, comments: 0.004 });
    const history = Array.from({ length: 6 }, (_, i) => post(`h${i}`, "image", 48 + i * 24, usual));
    // r: sends 2, saves 1, likes 1, comments 1 -> 0.40*2 + 0.30 + 0.15 + 0.15 = 1.40
    const p = post("p", "image", 30, rateMetrics({ sends: 0.02, saves: 0.01, likes: 0.05, comments: 0.004 }));

    const result = scorePost(p, [p, ...history], DEFAULT_SCORING_CONFIG, NOW);

    expect(result.signalsUsed).toEqual(["sends", "saves", "likes", "comments"]);
    expect(result.weightsUsed).toEqual({ sends: 0.4, saves: 0.3, likes: 0.15, comments: 0.15 });
    expect(result.score).toBeCloseTo(1.4, 10);
  });

  it("applies to carousels too", () => {
    const usual = rateMetrics({ sends: 0.01, saves: 0.01, likes: 0.05, comments: 0.004 });
    const history = Array.from({ length: 6 }, (_, i) => post(`h${i}`, "carousel", 48 + i * 24, usual));
    const p = post("p", "carousel", 30, usual);
    const result = scorePost(p, [p, ...history], DEFAULT_SCORING_CONFIG, NOW);
    expect(result.weightsUsed.watch_time).toBeUndefined();
    expect(result.score).toBeCloseTo(1, 10);
  });
});

describe("cap", () => {
  it("clamps each r at 5.0 so one viral signal cannot run away", () => {
    const usual = rateMetrics({ watch: 0.4, sends: 0.01, saves: 0.01, likes: 0.05, comments: 0.004 });
    const history = Array.from({ length: 6 }, (_, i) => reel(`h${i}`, 48 + i * 24, usual));
    // sends 20x usual -> capped at 5; everything else typical.
    const p = reel("p", 30, rateMetrics({ watch: 0.4, sends: 0.2, saves: 0.01, likes: 0.05, comments: 0.004 }));

    const result = scorePost(p, [p, ...history], DEFAULT_SCORING_CONFIG, NOW);

    expect(result.rValues.sends).toBe(5);
    // 0.35 + 0.25*5 + 0.20 + 0.10 + 0.10 = 2.00
    expect(result.score).toBeCloseTo(2.0, 10);
    expect(result.label).toBe("strong");
  });
});

describe("too_early", () => {
  const usual = rateMetrics({ watch: 0.4, sends: 0.01, saves: 0.01, likes: 0.05, comments: 0.004 });
  const history = Array.from({ length: 6 }, (_, i) => reel(`h${i}`, 48 + i * 24, usual));

  it("labels a post younger than 24h too_early with no score", () => {
    const p = reel("p", 23.9, usual);
    const result = scorePost(p, [p, ...history], DEFAULT_SCORING_CONFIG, NOW);
    expect(result).toMatchObject({ label: "too_early", score: null, signalsUsed: [] });
  });

  it("scores a post at exactly 24h", () => {
    const p = reel("p", 24, usual);
    expect(scorePost(p, [p, ...history], DEFAULT_SCORING_CONFIG, NOW).label).toBe("normal");
  });

  it("excludes young posts from the baseline", () => {
    const young = Array.from({ length: 10 }, (_, i) => reel(`y${i}`, 1 + i, usual));
    const b = computeBaseline([...young, ...history], {
      format: "reel",
      now: NOW,
      minAgeHours: 24,
      medianWindow: 30,
    });
    expect(b.nPosts).toBe(6);
  });
});

describe("baseline_building", () => {
  const usual = rateMetrics({ watch: 0.4, sends: 0.01, saves: 0.01, likes: 0.05, comments: 0.004 });

  it("needs 5 eligible posts of the same format, not counting the post itself", () => {
    const four = Array.from({ length: 4 }, (_, i) => reel(`h${i}`, 48 + i * 24, usual));
    const p = reel("p", 30, usual);
    expect(scorePost(p, [p, ...four], DEFAULT_SCORING_CONFIG, NOW)).toMatchObject({
      label: "baseline_building",
      score: null,
    });

    const five = [...four, reel("h4", 200, usual)];
    expect(scorePost(p, [p, ...five], DEFAULT_SCORING_CONFIG, NOW).label).toBe("normal");
  });

  it("ignores other formats when counting", () => {
    const images = Array.from({ length: 10 }, (_, i) => post(`i${i}`, "image", 48 + i * 24, usual));
    const p = reel("p", 30, usual);
    expect(scorePost(p, [p, ...images], DEFAULT_SCORING_CONFIG, NOW).label).toBe("baseline_building");
  });

  it("uses only the last medianWindow posts", () => {
    const old = Array.from({ length: 30 }, (_, i) =>
      reel(`old${i}`, 1000 + i * 24, rateMetrics({ watch: 0.1, sends: 0.001, saves: 0.001, likes: 0.01, comments: 0.001 })),
    );
    const recent = Array.from({ length: 5 }, (_, i) => reel(`new${i}`, 48 + i * 24, usual));
    const b = computeBaseline([...old, ...recent], { format: "reel", now: NOW, minAgeHours: 24, medianWindow: 5 });
    expect(b.nPosts).toBe(5);
    expect(b.medians.sends).toBeCloseTo(0.01, 10);
  });
});

describe("zero median renormalisation", () => {
  it("drops a signal whose median is 0 and renormalises the rest to sum to 1", () => {
    // Nobody ever comments: comments median = 0.
    const usual = rateMetrics({ watch: 0.4, sends: 0.01, saves: 0.01, likes: 0.05, comments: 0 });
    const history = Array.from({ length: 6 }, (_, i) => reel(`h${i}`, 48 + i * 24, usual));
    const p = reel("p", 30, rateMetrics({ watch: 0.8, sends: 0.01, saves: 0.01, likes: 0.05, comments: 0.01 }));

    const result = scorePost(p, [p, ...history], DEFAULT_SCORING_CONFIG, NOW);

    expect(result.signalsUsed).toEqual(["watch_time", "sends", "saves", "likes"]);
    const total = Object.values(result.weightsUsed).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(result.weightsUsed.watch_time).toBeCloseTo(0.35 / 0.9, 10);
    // (0.35*2 + 0.25 + 0.20 + 0.10) / 0.9
    expect(result.score).toBeCloseTo(1.25 / 0.9, 10);
  });

  it("drops watch time on a reel with no watch data and renormalises", () => {
    const usual = rateMetrics({ sends: 0.01, saves: 0.01, likes: 0.05, comments: 0.004 });
    const history = Array.from({ length: 6 }, (_, i) => reel(`h${i}`, 48 + i * 24, usual));
    const p = reel("p", 30, usual);
    const result = scorePost(p, [p, ...history], DEFAULT_SCORING_CONFIG, NOW);
    expect(result.signalsUsed).not.toContain("watch_time");
    expect(result.score).toBeCloseTo(1, 10);
  });

  it("falls back to baseline_building when fewer than 2 signals survive", () => {
    const usual = rateMetrics({ sends: 0, saves: 0, likes: 0.05, comments: 0 });
    const history = Array.from({ length: 6 }, (_, i) => post(`h${i}`, "image", 48 + i * 24, usual));
    const p = post("p", "image", 30, usual);
    expect(scorePost(p, [p, ...history], DEFAULT_SCORING_CONFIG, NOW)).toMatchObject({
      label: "baseline_building",
      score: null,
    });
  });
});

describe("reach 0", () => {
  const usual = rateMetrics({ watch: 0.4, sends: 0.01, saves: 0.01, likes: 0.05, comments: 0.004 });
  const zeroReach: MetricSnapshot = { reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, avgWatchTimeMs: 0 };

  it("labels the post too_early with no score", () => {
    const history = Array.from({ length: 6 }, (_, i) => reel(`h${i}`, 48 + i * 24, usual));
    const p = reel("p", 30, zeroReach);
    expect(scorePost(p, [p, ...history], DEFAULT_SCORING_CONFIG, NOW)).toMatchObject({
      label: "too_early",
      score: null,
    });
  });

  it("drops the post from other posts' baselines", () => {
    const history = Array.from({ length: 5 }, (_, i) => reel(`h${i}`, 48 + i * 24, usual));
    const dead = reel("dead", 300, zeroReach);
    const b = computeBaseline([...history, dead], { format: "reel", now: NOW, minAgeHours: 24, medianWindow: 30 });
    expect(b.nPosts).toBe(5);
  });

  it("treats a never-measured post the same way", () => {
    const history = Array.from({ length: 6 }, (_, i) => reel(`h${i}`, 48 + i * 24, usual));
    const p: ScorablePost = { ...reel("p", 30, usual), metrics: null };
    expect(scorePost(p, [p, ...history], DEFAULT_SCORING_CONFIG, NOW).label).toBe("too_early");
  });
});

describe("label boundaries", () => {
  const { strongCutoff, weakCutoff } = DEFAULT_SCORING_CONFIG;

  it("is normal at exactly 0.9", () => expect(labelFor(0.9, strongCutoff, weakCutoff)).toBe("normal"));
  it("is weak just below 0.9", () => expect(labelFor(0.8999, strongCutoff, weakCutoff)).toBe("weak"));
  it("is normal at exactly 1.5", () => expect(labelFor(1.5, strongCutoff, weakCutoff)).toBe("normal"));
  it("is strong just above 1.5", () => expect(labelFor(1.5001, strongCutoff, weakCutoff)).toBe("strong"));
  it("honours custom cutoffs", () => expect(labelFor(1.3, 1.2, 0.8)).toBe("strong"));
});

describe("determinism", () => {
  it("gives identical results for identical inputs", () => {
    const usual = rateMetrics({ watch: 0.4, sends: 0.01, saves: 0.01, likes: 0.05, comments: 0.004 });
    const history = Array.from({ length: 8 }, (_, i) => reel(`h${i}`, 48 + i * 24, usual));
    const p = reel("p", 30, rateMetrics({ watch: 0.5, sends: 0.02, saves: 0.01, likes: 0.04, comments: 0.004 }));
    const a = scorePost(p, [p, ...history], DEFAULT_SCORING_CONFIG, NOW);
    const b = scorePost(p, [p, ...history], DEFAULT_SCORING_CONFIG, NOW);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-13T12:00:00Z");
const REACH = 100_000;
const DURATION_MS = 30_000;

interface RateSpec {
  watch?: number;
  sends: number;
  saves: number;
  likes: number;
  comments: number;
}

/** Builds a snapshot whose rates per reach are exactly the given fractions. */
function rateMetrics(r: RateSpec): MetricSnapshot {
  return {
    reach: REACH,
    shares: r.sends * REACH,
    saves: r.saves * REACH,
    likes: r.likes * REACH,
    comments: r.comments * REACH,
    avgWatchTimeMs: r.watch === undefined ? null : r.watch * DURATION_MS,
  };
}

function post(id: string, format: PostFormat, ageHours: number, metrics: MetricSnapshot): ScorablePost {
  return {
    id,
    format,
    postedAt: new Date(NOW.getTime() - ageHours * 3_600_000),
    durationMs: format === "reel" ? DURATION_MS : null,
    metrics,
  };
}

function reel(id: string, ageHours: number, metrics: MetricSnapshot): ScorablePost {
  return post(id, "reel", ageHours, metrics);
}
