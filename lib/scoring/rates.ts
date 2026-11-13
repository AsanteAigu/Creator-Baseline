import type { MetricSnapshot, Signal } from "./types";

export type Rates = Record<Signal, number | null>;

/**
 * Turns counts into per-reach rates (§5). Returns null when the post cannot be rated at
 * all (no snapshot, or reach 0 — edge case 4). Watch rate is null when the post has no
 * duration or no watch time, which is normal for photos and carousels.
 */
export function computeRates(metrics: MetricSnapshot | null, durationMs: number | null): Rates | null {
  if (metrics === null || metrics.reach <= 0) return null;
  const { reach } = metrics;
  const watchRate =
    metrics.avgWatchTimeMs !== null && durationMs !== null && durationMs > 0
      ? metrics.avgWatchTimeMs / durationMs
      : null;
  return {
    watch_time: watchRate,
    sends: metrics.shares / reach,
    saves: metrics.saves / reach,
    likes: metrics.likes / reach,
    comments: metrics.comments / reach,
  };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Indices are in range by construction; the fallbacks only satisfy noUncheckedIndexedAccess.
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? null)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
