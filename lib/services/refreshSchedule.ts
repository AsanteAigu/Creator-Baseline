/**
 * How often a post's insights are re-read (D-048). Instagram calls are the slow part of an
 * update and run one at a time (SPECIFICATION §6), so the fastest update is one that makes
 * fewer of them. A new post still moves by the hour; a month-old one barely moves in a day.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Posts at least this old are read once and then left alone (D-045). */
export const FROZEN_AFTER_DAYS = 120;

/** [post younger than, re-read when the last reading is at least this old]. */
const TIERS: [ageMs: number, gapMs: number][] = [
  [2 * DAY_MS, 0],
  [7 * DAY_MS, 3 * HOUR_MS],
  [30 * DAY_MS, 12 * HOUR_MS],
  [FROZEN_AFTER_DAYS * DAY_MS, 48 * HOUR_MS],
];

export type InsightsDue = "fetch" | "skip" | "backfill";

/**
 * "backfill" is a never-read post past the refresh window: read it, but within the per-run
 * backfill cap so a large account's first year is spread over a few runs.
 */
export function insightsDue(postedAt: Date, lastCapturedAt: Date | null, now: Date): InsightsDue {
  const age = now.getTime() - postedAt.getTime();
  if (lastCapturedAt === null) return age >= FROZEN_AFTER_DAYS * DAY_MS ? "backfill" : "fetch";
  const since = now.getTime() - lastCapturedAt.getTime();
  for (const [maxAge, gap] of TIERS) {
    if (age < maxAge) return since >= gap ? "fetch" : "skip";
  }
  return "skip";
}
