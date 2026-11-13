import { computeBaseline, isOldEnough } from "./baseline";
import { computeRates } from "./rates";
import {
  MIN_BASELINE_POSTS,
  MIN_SIGNALS,
  SIGNALS,
  type Label,
  type ScorablePost,
  type ScoreResult,
  type ScoringConfig,
  type Signal,
  type SignalValues,
  type Weights,
} from "./types";

/** score = Σ w_i · r_i. No rounding here: rounding happens only at storage/display (§5.5). */
export function combineScore(rValues: SignalValues, weights: Weights): number {
  let total = 0;
  for (const signal of SIGNALS) {
    const w = weights[signal] ?? 0;
    const r = rValues[signal];
    if (w > 0 && r !== undefined) total += w * r;
  }
  return total;
}

export function clampRatio(value: number, cap: number): number {
  return Math.min(Math.max(value, 0), cap);
}

/** Rescales the kept weights so they sum to 1 (§5 edge case 3). */
export function renormalise(weights: Weights, keep: readonly Signal[]): Weights {
  const sum = keep.reduce((acc, s) => acc + (weights[s] ?? 0), 0);
  const out: Weights = {};
  if (sum <= 0) return out;
  for (const s of keep) out[s] = (weights[s] ?? 0) / sum;
  return out;
}

export function labelFor(score: number, strongCutoff: number, weakCutoff: number): Label {
  if (score > strongCutoff) return "strong";
  if (score >= weakCutoff) return "normal";
  return "weak";
}

/** Reels use the full weights; formats without watch time use the photo weights (§5). */
export function weightsFor(format: ScorablePost["format"], config: ScoringConfig): Weights {
  return format === "reel" ? config.weights : config.photoWeights;
}

function unscored(postId: string, label: Label): ScoreResult {
  return { postId, label, score: null, rValues: {}, weightsUsed: {}, signalsUsed: [] };
}

/**
 * Scores one post against the creator's own history. `history` is every post the creator
 * has (it may include this post; it is excluded from its own baseline here).
 */
export function scorePost(
  post: ScorablePost,
  history: readonly ScorablePost[],
  config: ScoringConfig,
  now: Date,
): ScoreResult {
  // Edge case 1: too young to judge.
  if (!isOldEnough(post.postedAt, now, config.minAgeHours)) return unscored(post.id, "too_early");

  // Edge case 4: reach 0 (or never measured) cannot be rated.
  const rates = computeRates(post.metrics, post.durationMs);
  if (rates === null) return unscored(post.id, "too_early");

  // Edge case 2: not enough history of this format.
  const baseline = computeBaseline(history, {
    format: post.format,
    now,
    minAgeHours: config.minAgeHours,
    medianWindow: config.medianWindow,
    excludePostId: post.id,
  });
  if (baseline.nPosts < MIN_BASELINE_POSTS) return unscored(post.id, "baseline_building");

  const baseWeights = weightsFor(post.format, config);
  const rValues: SignalValues = {};
  const usable: Signal[] = [];
  for (const signal of SIGNALS) {
    if ((baseWeights[signal] ?? 0) <= 0) continue;
    const m = baseline.medians[signal];
    const x = rates[signal];
    // Edge case 3: a zero/missing median (or a missing post rate) drops the signal.
    if (m === null || m === 0 || x === null) continue;
    rValues[signal] = clampRatio(x / m, config.cap);
    usable.push(signal);
  }
  if (usable.length < MIN_SIGNALS) return unscored(post.id, "baseline_building");

  const weightsUsed = renormalise(baseWeights, usable);
  const score = combineScore(rValues, weightsUsed);
  return {
    postId: post.id,
    label: labelFor(score, config.strongCutoff, config.weakCutoff),
    score,
    rValues,
    weightsUsed,
    signalsUsed: usable,
  };
}

/** Scores every post of a creator in one pass. Pure: same inputs, same outputs. */
export function scoreAll(
  posts: readonly ScorablePost[],
  config: ScoringConfig,
  now: Date,
): ScoreResult[] {
  return posts.map((p) => scorePost(p, posts, config, now));
}

/** Storage precision (§5.5): numeric(6,4). Applied only after summing. */
export function roundForStorage(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
