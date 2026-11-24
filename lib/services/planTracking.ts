import type { PostView } from "@/lib/repositories";
import type { Label, PostFormat } from "@/lib/scoring";
import { addDaysIso, londonIsoDate } from "./time";

/**
 * Tracks whether used plan ideas are working (DECISIONS.md D-047). An idea marked "used" is
 * matched to the creator's post of the same format published closest to its planned day,
 * within a window around both the planned day and the day it was marked. Matching is
 * deterministic and read-time only, so no link has to be stored and a late post still counts.
 */

/** Posts up to this many days before the planned (or marked) day can be the one that used it. */
export const MATCH_DAYS_BEFORE = 2;
/** ...and up to this many days after. Past this with no post, the idea counts as not posted. */
export const MATCH_DAYS_AFTER = 7;
/** Fewer scored plan posts than this and the verdict stays "too early". */
export const MIN_SCORED_FOR_VERDICT = 2;

export interface UsedIdea {
  id: string;
  title: string;
  format: PostFormat;
  suggestedDate: string | null;
  decidedAt: Date;
}

export interface MatchedPost {
  id: string;
  postedAt: Date;
  permalink: string | null;
  captionExcerpt: string | null;
  reach: number | null;
  score: number | null;
  label: Label | null;
}

export type IdeaOutcome =
  | { state: "waiting"; until: string }
  | { state: "not_posted" }
  | { state: "scoring"; post: MatchedPost }
  | { state: "scored"; post: MatchedPost & { score: number } };

export interface TrackedIdea extends UsedIdea {
  outcome: IdeaOutcome;
}

export type Verdict = "too_early" | "working" | "mixed" | "not_working";

export interface PlanTracking {
  ideas: TrackedIdea[];
  usedCount: number;
  postedCount: number;
  scoredCount: number;
  strongCount: number;
  weakCount: number;
  /** Mean score of scored plan posts; 1.0 is the creator's usual. */
  planAverage: number | null;
  /** Mean score of the creator's other scored posts over the same span, for comparison. */
  otherAverage: number | null;
  verdict: Verdict;
}

function anchorDay(idea: UsedIdea): string {
  const marked = londonIsoDate(idea.decidedAt);
  if (!idea.suggestedDate) return marked;
  return idea.suggestedDate < marked ? idea.suggestedDate : marked;
}

function windowFor(idea: UsedIdea): { from: string; to: string } {
  const marked = londonIsoDate(idea.decidedAt);
  const latest = idea.suggestedDate && idea.suggestedDate > marked ? idea.suggestedDate : marked;
  return { from: addDaysIso(anchorDay(idea), -MATCH_DAYS_BEFORE), to: addDaysIso(latest, MATCH_DAYS_AFTER) };
}

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function toMatched(p: PostView): MatchedPost {
  return {
    id: p.id,
    postedAt: p.postedAt,
    permalink: p.permalink,
    captionExcerpt: p.captionExcerpt,
    reach: p.reach,
    score: p.score,
    label: p.label,
  };
}

/** The verdict compares plan posts with the creator's usual (1.0) and with their other posts. */
export function verdictFor(planAverage: number | null, otherAverage: number | null, scoredCount: number): Verdict {
  if (planAverage === null || scoredCount < MIN_SCORED_FOR_VERDICT) return "too_early";
  const beatsOthers = otherAverage === null || planAverage >= otherAverage;
  if (planAverage >= 1 && beatsOthers) return "working";
  if (planAverage < 1 && !beatsOthers) return "not_working";
  return "mixed";
}

export function trackUsedIdeas(used: UsedIdea[], posts: PostView[], now: Date): PlanTracking {
  const today = londonIsoDate(now);
  const claimed = new Set<string>();
  // Oldest decision first, so an earlier idea keeps its post when two could claim it.
  const ordered = [...used].sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime());
  const outcomes = new Map<string, IdeaOutcome>();

  for (const idea of ordered) {
    const { from, to } = windowFor(idea);
    const target = idea.suggestedDate ?? londonIsoDate(idea.decidedAt);
    const candidates = posts
      .filter((p) => p.format === idea.format && !claimed.has(p.id))
      .map((p) => ({ post: p, day: londonIsoDate(p.postedAt) }))
      .filter((c) => c.day >= from && c.day <= to)
      .sort((a, b) => dayDistance(a.day, target) - dayDistance(b.day, target) || a.day.localeCompare(b.day));
    const match = candidates[0]?.post;
    if (match) {
      claimed.add(match.id);
      const post = toMatched(match);
      outcomes.set(
        idea.id,
        post.score === null ? { state: "scoring", post } : { state: "scored", post: { ...post, score: post.score } },
      );
    } else {
      outcomes.set(idea.id, today <= to ? { state: "waiting", until: to } : { state: "not_posted" });
    }
  }

  const ideas: TrackedIdea[] = used.map((idea) => ({ ...idea, outcome: outcomes.get(idea.id) ?? { state: "not_posted" } }));
  const scored = ideas.flatMap((i) => (i.outcome.state === "scored" ? [i.outcome.post] : []));
  const planAverage = mean(scored.map((p) => p.score));

  // Compare like with like: other scored posts from the first used idea's window onwards.
  const earliest = ordered[0] ? windowFor(ordered[0]).from : null;
  const others = posts.filter(
    (p) => p.score !== null && !claimed.has(p.id) && earliest !== null && londonIsoDate(p.postedAt) >= earliest,
  );
  const otherAverage = mean(others.map((p) => p.score ?? 0));

  return {
    ideas,
    usedCount: ideas.length,
    postedCount: ideas.filter((i) => i.outcome.state === "scored" || i.outcome.state === "scoring").length,
    scoredCount: scored.length,
    strongCount: scored.filter((p) => p.label === "strong").length,
    weakCount: scored.filter((p) => p.label === "weak").length,
    planAverage,
    otherAverage,
    verdict: verdictFor(planAverage, otherAverage, scored.length),
  };
}

/** Lowercase letters and digits only, so "Garlic noodles!" and "garlic  noodles" are one idea. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isRepeat(title: string, taken: Iterable<string>): boolean {
  const key = normaliseTitle(title);
  for (const t of taken) if (normaliseTitle(t) === key) return true;
  return false;
}
