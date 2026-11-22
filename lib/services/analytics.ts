import type { PostView } from "@/lib/repositories";
import type { Label, PostFormat } from "@/lib/scoring";
import { addDaysIso, londonIsoDate, weekStartLondon } from "./time";

/**
 * Descriptive aggregates for the analytics views. Pure: everything is derived from post rows
 * the caller already loaded. These summarise existing scores; they never score or label.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const ANALYTICS_PERIOD_DAYS = 28;
export const REACH_WEEKS = 12;
const FORMATS: PostFormat[] = ["reel", "carousel", "image"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface PeriodSummary {
  posts: number;
  scored: number;
  averageScore: number | null;
  /** Share of scored posts labelled strong, 0..1. */
  strongShare: number | null;
  totalReach: number;
  medianReach: number | null;
}

export interface GroupSummary {
  key: string;
  posts: number;
  scored: number;
  averageScore: number | null;
  medianReach: number | null;
}

export interface WeeklyReach {
  /** Monday of the London week, YYYY-MM-DD. */
  weekStart: string;
  reach: number;
  posts: number;
}

export interface AccountAnalytics {
  current: PeriodSummary;
  previous: PeriodSummary;
  byFormat: GroupSummary[];
  byWeekday: GroupSummary[];
  weeklyReach: WeeklyReach[];
  labelMix: Record<"strong" | "normal" | "weak", number>;
}

const SCORED_LABELS = new Set<Label>(["strong", "normal", "weak"]);

function isScored(p: PostView): p is PostView & { score: number; label: Label } {
  return p.score !== null && p.label !== null && SCORED_LABELS.has(p.label);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function summarisePeriod(posts: PostView[]): PeriodSummary {
  const scored = posts.filter(isScored);
  const reaches = posts.flatMap((p) => (p.reach === null ? [] : [p.reach]));
  return {
    posts: posts.length,
    scored: scored.length,
    averageScore: mean(scored.map((p) => p.score)),
    strongShare: scored.length === 0 ? null : scored.filter((p) => p.label === "strong").length / scored.length,
    totalReach: reaches.reduce((a, b) => a + b, 0),
    medianReach: median(reaches),
  };
}

function summariseGroup(key: string, posts: PostView[]): GroupSummary {
  const scored = posts.filter(isScored);
  return {
    key,
    posts: posts.length,
    scored: scored.length,
    averageScore: mean(scored.map((p) => p.score)),
    medianReach: median(posts.flatMap((p) => (p.reach === null ? [] : [p.reach]))),
  };
}

/** Monday = 0 … Sunday = 6, on the London calendar. */
function londonWeekday(d: Date): number {
  return (new Date(`${londonIsoDate(d)}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function within(posts: PostView[], from: Date, to: Date): PostView[] {
  return posts.filter((p) => p.postedAt >= from && p.postedAt < to);
}

export function buildAccountAnalytics(posts: PostView[], now: Date): AccountAnalytics {
  const periodMs = ANALYTICS_PERIOD_DAYS * DAY_MS;
  const currentStart = new Date(now.getTime() - periodMs);
  const current = within(posts, currentStart, now);
  const previous = within(posts, new Date(currentStart.getTime() - periodMs), currentStart);

  // Breakdowns use the last 90 days so each group has enough posts to mean something.
  const recent = within(posts, new Date(now.getTime() - 90 * DAY_MS), now);

  const byFormat = FORMATS.map((f) => summariseGroup(f, recent.filter((p) => p.format === f))).filter(
    (g) => g.posts > 0,
  );
  const byWeekday = WEEKDAYS.map((day, i) => summariseGroup(day, recent.filter((p) => londonWeekday(p.postedAt) === i)));

  const thisWeek = weekStartLondon(now);
  const weeks = Array.from({ length: REACH_WEEKS }, (_, i) => addDaysIso(thisWeek, -7 * (REACH_WEEKS - 1 - i)));
  const weeklyReach = weeks.map((weekStart) => {
    const end = addDaysIso(weekStart, 7);
    const inWeek = posts.filter((p) => {
      const day = londonIsoDate(p.postedAt);
      return day >= weekStart && day < end;
    });
    return {
      weekStart,
      posts: inWeek.length,
      reach: inWeek.reduce((sum, p) => sum + (p.reach ?? 0), 0),
    };
  });

  const scoredCurrent = current.filter(isScored);
  return {
    current: summarisePeriod(current),
    previous: summarisePeriod(previous),
    byFormat,
    byWeekday,
    weeklyReach,
    labelMix: {
      strong: scoredCurrent.filter((p) => p.label === "strong").length,
      normal: scoredCurrent.filter((p) => p.label === "normal").length,
      weak: scoredCurrent.filter((p) => p.label === "weak").length,
    },
  };
}

export interface Change {
  direction: "up" | "down" | "flat";
  /** Relative change as a fraction, e.g. 0.12 for +12%. Null when there is nothing to compare. */
  relative: number | null;
  /** Absolute difference, for values already on a ratio scale such as scores. */
  absolute: number | null;
}

/** Period-over-period change. Under 0.5% either way reads as flat. */
export function compareValues(current: number | null, previous: number | null): Change {
  if (current === null || previous === null) return { direction: "flat", relative: null, absolute: null };
  const absolute = current - previous;
  const relative = previous === 0 ? null : absolute / previous;
  const size = relative ?? (absolute === 0 ? 0 : 1);
  return { direction: Math.abs(size) < 0.005 ? "flat" : absolute > 0 ? "up" : "down", relative, absolute };
}
