import { computeRates, median, type Rates } from "./rates";
import { SIGNALS, type Baseline, type PostFormat, type ScorablePost, type Signal } from "./types";

const HOUR_MS = 60 * 60 * 1000;

export interface BaselineOptions {
  format: PostFormat;
  now: Date;
  minAgeHours: number;
  medianWindow: number;
  /** The post being scored never counts towards its own baseline. */
  excludePostId?: string;
}

export function isOldEnough(postedAt: Date, now: Date, minAgeHours: number): boolean {
  return now.getTime() - postedAt.getTime() >= minAgeHours * HOUR_MS;
}

/**
 * The creator's usual rates: medians over their last `medianWindow` eligible posts of the
 * same format. Eligible = old enough and reach > 0 (§5 baseline + edge case 4).
 */
export function computeBaseline(posts: readonly ScorablePost[], opts: BaselineOptions): Baseline {
  const eligible: { post: ScorablePost; rates: Rates }[] = [];
  for (const post of posts) {
    if (post.format !== opts.format || post.id === opts.excludePostId) continue;
    if (!isOldEnough(post.postedAt, opts.now, opts.minAgeHours)) continue;
    const rates = computeRates(post.metrics);
    if (rates !== null) eligible.push({ post, rates });
  }
  eligible.sort((a, b) => b.post.postedAt.getTime() - a.post.postedAt.getTime());
  const window = eligible.slice(0, opts.medianWindow);

  const medians = {} as Record<Signal, number | null>;
  for (const signal of SIGNALS) {
    medians[signal] = median(
      window.map((e) => e.rates[signal]).filter((v): v is number => v !== null),
    );
  }

  return {
    format: opts.format,
    nPosts: window.length,
    medianReach: median(window.map((e) => e.post.metrics?.reach ?? 0)),
    medians,
  };
}
