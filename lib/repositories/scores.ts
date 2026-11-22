import type { Tx } from "@/lib/db/client";
import type { Baseline, Label, PostFormat, Signal, Weights } from "@/lib/scoring";

/** What a score was computed with, so old scores stay explainable after settings change. */
export interface WeightsSnapshot {
  base: Weights;
  applied: Weights;
  cap: number;
  strongCutoff: number;
  weakCutoff: number;
}

export interface ScoreWrite {
  postId: string;
  /** Already rounded to storage precision. */
  score: number | null;
  label: Label;
  rValues: Partial<Record<Signal, number>>;
  weightsSnapshot: WeightsSnapshot;
  signalsUsed: Signal[];
}

export interface BaselineView {
  format: PostFormat;
  nPosts: number;
  medianReach: number | null;
  medianLikes: number | null;
  medianComments: number | null;
  medianShares: number | null;
  medianSaves: number | null;
  medianWatchRate: number | null;
  computedAt: Date;
}

export interface TrendPoint {
  postId: string;
  postedAt: Date;
  format: PostFormat;
  score: number;
  label: Label;
}

export function scoresRepo(tx: Tx) {
  return {
    /** One baseline row per format per run; re-running the window overwrites it. */
    async upsertBaseline(creatorId: string, runId: string, b: Baseline, now: Date): Promise<void> {
      await tx`
        insert into public.baselines
          (creator_id, run_id, format, computed_at, n_posts, median_reach, median_likes,
           median_comments, median_shares, median_saves, median_watch_rate)
        values
          (${creatorId}, ${runId}, ${b.format}, ${now}, ${b.nPosts}, ${b.medianReach},
           ${b.medians.likes}, ${b.medians.comments}, ${b.medians.sends}, ${b.medians.saves},
           ${b.medians.watch_time})
        on conflict (run_id, format) do update set
          computed_at = excluded.computed_at, n_posts = excluded.n_posts,
          median_reach = excluded.median_reach, median_likes = excluded.median_likes,
          median_comments = excluded.median_comments, median_shares = excluded.median_shares,
          median_saves = excluded.median_saves, median_watch_rate = excluded.median_watch_rate
      `;
    },

    /** One score per post per run. Old runs keep the weights they were computed with. */
    async upsertScores(runId: string, now: Date, scores: ScoreWrite[]): Promise<void> {
      if (scores.length === 0) return;
      const rows = scores.map((s) => ({
        post_id: s.postId,
        run_id: runId,
        score: s.score,
        label: s.label,
        r_values: s.rValues,
        weights_snapshot: s.weightsSnapshot,
        signals_used: s.signalsUsed,
        computed_at: now,
      }));
      await tx`
        insert into public.post_scores ${tx(rows)}
        on conflict (post_id, run_id) do update set
          score = excluded.score, label = excluded.label, r_values = excluded.r_values,
          weights_snapshot = excluded.weights_snapshot, signals_used = excluded.signals_used,
          computed_at = excluded.computed_at
      `;
    },

    async latestBaselines(creatorId: string): Promise<BaselineView[]> {
      const rows = await tx<
        {
          format: PostFormat;
          n_posts: number;
          median_reach: number | null;
          median_likes: number | null;
          median_comments: number | null;
          median_shares: number | null;
          median_saves: number | null;
          median_watch_rate: number | null;
          computed_at: Date;
        }[]
      >`
        select distinct on (format) format, n_posts, median_reach, median_likes, median_comments,
               median_shares, median_saves, median_watch_rate, computed_at
        from public.baselines
        where creator_id = ${creatorId}
        order by format, computed_at desc
      `;
      return rows.map((r) => ({
        format: r.format,
        nPosts: r.n_posts,
        medianReach: r.median_reach,
        medianLikes: r.median_likes,
        medianComments: r.median_comments,
        medianShares: r.median_shares,
        medianSaves: r.median_saves,
        medianWatchRate: r.median_watch_rate,
        computedAt: r.computed_at,
      }));
    },

    /** Scored posts from one run, oldest first — the account page's trend line. */
    async trendForRun(runId: string): Promise<TrendPoint[]> {
      const rows = await tx<{ post_id: string; posted_at: Date; format: PostFormat; score: number; label: Label }[]>`
        select s.post_id, p.posted_at, p.format, s.score, s.label
        from public.post_scores s
        join public.posts p on p.id = s.post_id
        where s.run_id = ${runId} and s.score is not null
        order by p.posted_at asc
      `;
      return rows.map((r) => ({
        postId: r.post_id,
        postedAt: r.posted_at,
        format: r.format,
        score: r.score,
        label: r.label,
      }));
    },

    async labelCountsForRun(runId: string): Promise<Record<Label, number>> {
      const rows = await tx<{ label: Label; n: number }[]>`
        select label, count(*)::int as n from public.post_scores where run_id = ${runId} group by label
      `;
      const out: Record<Label, number> = { strong: 0, normal: 0, weak: 0, too_early: 0, baseline_building: 0 };
      for (const r of rows) out[r.label] = r.n;
      return out;
    },
  };
}
