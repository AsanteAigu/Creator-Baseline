import type { PostView } from "@/lib/repositories";
import { median } from "./analytics";
import type { TrackedIdea } from "./planTracking";
import { londonIsoDate } from "./time";

/**
 * The recommendation model behind the plan (D-049): what has worked for this creator, worked
 * out deterministically from their own scores, so the AI chooses formats, days and kinds of
 * idea from computed evidence instead of guessing from a handful of top posts.
 */

/** A bucket with fewer scored posts than this is too thin to steer the plan. */
export const MIN_BUCKET = 3;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface Bucket {
  key: string;
  posts: number;
  /** Median score; 1.00 is this creator's usual. Rounded to 2 dp, as the UI shows. */
  median: number;
  /** Share of the bucket's posts labelled strong, 0 to 1, rounded to 2 dp. */
  strongShare: number;
}

export interface PlanProfile {
  formats: Bucket[];
  weekdays: Bucket[];
  /** How posts made from earlier plan ideas scored, by format. */
  planIdeas: Bucket[];
  /** Plain-language guidance derived from the buckets above, strongest first. */
  guidance: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function bucketise(items: { key: string; score: number; strong: boolean }[]): Bucket[] {
  const groups = new Map<string, { scores: number[]; strong: number }>();
  for (const i of items) {
    const g = groups.get(i.key) ?? { scores: [], strong: 0 };
    g.scores.push(i.score);
    if (i.strong) g.strong += 1;
    groups.set(i.key, g);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.scores.length >= MIN_BUCKET)
    .map(([key, g]) => ({
      key,
      posts: g.scores.length,
      median: round2(median(g.scores) ?? 0),
      strongShare: round2(g.strong / g.scores.length),
    }))
    .sort((a, b) => b.median - a.median || b.posts - a.posts);
}

function weekdayOf(d: Date): string {
  return WEEKDAYS[new Date(`${londonIsoDate(d)}T12:00:00Z`).getUTCDay()] ?? "Monday";
}

export function buildPlanProfile(posts: readonly PostView[], tracked: readonly TrackedIdea[]): PlanProfile {
  const scored = posts.filter((p) => p.score !== null);
  const formats = bucketise(scored.map((p) => ({ key: p.format, score: p.score ?? 0, strong: p.label === "strong" })));
  const weekdays = bucketise(
    scored.map((p) => ({ key: weekdayOf(p.postedAt), score: p.score ?? 0, strong: p.label === "strong" })),
  );
  const planIdeas = bucketise(
    tracked.flatMap((t) =>
      t.outcome.state === "scored"
        ? [{ key: t.format, score: t.outcome.post.score, strong: t.outcome.post.label === "strong" }]
        : [],
    ),
  );

  const guidance: string[] = [];
  const bestFormat = formats[0];
  const worstFormat = formats[formats.length - 1];
  if (bestFormat && bestFormat.median >= 1) {
    guidance.push(`Lead with ${bestFormat.key}s: median score ${bestFormat.median.toFixed(2)} over ${bestFormat.posts} posts.`);
  }
  if (worstFormat && worstFormat !== bestFormat && worstFormat.median < 0.9) {
    guidance.push(
      `Use ${worstFormat.key}s sparingly and only with a new angle: median ${worstFormat.median.toFixed(2)}.`,
    );
  }
  const strongDays = weekdays.filter((w) => w.median >= 1).slice(0, 3);
  if (strongDays.length > 0) {
    guidance.push(`Put the strongest ideas on ${strongDays.map((d) => d.key).join(", ")}, the best-scoring days.`);
  }
  const weakDays = weekdays.filter((w) => w.median < 0.9);
  if (weakDays.length > 0) {
    guidance.push(`Keep lighter or experimental ideas for ${weakDays.map((d) => d.key).join(", ")}.`);
  }
  for (const p of planIdeas) {
    guidance.push(
      p.median >= 1
        ? `Earlier plan ${p.key}s worked (median ${p.median.toFixed(2)}): more ideas of that kind.`
        : `Earlier plan ${p.key}s underperformed (median ${p.median.toFixed(2)}): change the approach.`,
    );
  }
  if (guidance.length === 0) guidance.push("Not enough scored posts yet to favour a format or day.");

  return { formats, weekdays, planIdeas, guidance };
}
