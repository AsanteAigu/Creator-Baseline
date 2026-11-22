export type PostFormat = "reel" | "image" | "carousel";

export const SIGNALS = ["watch_time", "sends", "saves", "likes", "comments"] as const;
export type Signal = (typeof SIGNALS)[number];

/** Weight per signal. Absent or zero means the signal does not count. */
export type Weights = Partial<Record<Signal, number>>;

/** Per-signal values; absent means "not used for this post". */
export type SignalValues = Partial<Record<Signal, number>>;

export type Label = "strong" | "normal" | "weak" | "too_early" | "baseline_building";

export interface ScoringConfig {
  weights: Weights;
  photoWeights: Weights;
  cap: number;
  strongCutoff: number;
  weakCutoff: number;
  minAgeHours: number;
  medianWindow: number;
}

/** The metric snapshot the rates are derived from (SPECIFICATION §5). */
export interface MetricSnapshot {
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  avgWatchTimeMs: number | null;
}

export interface ScorablePost {
  id: string;
  format: PostFormat;
  postedAt: Date;
  durationMs: number | null;
  /** Latest snapshot; null when the post has never been measured. */
  metrics: MetricSnapshot | null;
}

export interface Baseline {
  format: PostFormat;
  nPosts: number;
  medianReach: number | null;
  medians: Record<Signal, number | null>;
}

export interface ScoreResult {
  postId: string;
  label: Label;
  /** Unrounded. Null for too_early and baseline_building. */
  score: number | null;
  rValues: SignalValues;
  /** The renormalised weights actually applied. */
  weightsUsed: Weights;
  signalsUsed: Signal[];
}

/** Below this many eligible posts of a format there is no baseline (§5 edge case 2). */
export const MIN_BASELINE_POSTS = 5;
/** Fewer surviving signals than this and the score means nothing (§5 edge case 3). */
export const MIN_SIGNALS = 2;
