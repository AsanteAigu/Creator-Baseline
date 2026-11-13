import type { Tx } from "@/lib/db/client";

export interface ThemeAggregate {
  label: string;
  count: number;
  sentiment: "positive" | "neutral" | "negative";
  /** A model-written paraphrase — never a quoted comment. */
  exampleParaphrase: string;
}

export interface CommentInsight {
  runId: string;
  creatorId: string;
  positive: number;
  neutral: number;
  negative: number;
  themes: ThemeAggregate[];
  commentsSampled: number;
  model: string | null;
  createdAt: Date;
}

export interface ReportPoint {
  point: string;
  evidence: string;
}

export interface Report {
  id: string;
  creatorId: string;
  periodStart: Date;
  periodEnd: Date;
  headline: string | null;
  whatWorking: ReportPoint[];
  whatNotWorking: ReportPoint[];
  themes: ThemeAggregate[];
  sentiment: { positive: number; neutral: number; negative: number } | null;
  model: string | null;
  promptVersion: string | null;
  createdAt: Date;
}

interface ReportDbRow {
  id: string;
  creator_id: string;
  period_start: Date;
  period_end: Date;
  headline: string | null;
  what_working: ReportPoint[] | null;
  what_not_working: ReportPoint[] | null;
  themes: ThemeAggregate[] | null;
  sentiment: { positive: number; neutral: number; negative: number } | null;
  model: string | null;
  prompt_version: string | null;
  created_at: Date;
}

function toReport(r: ReportDbRow): Report {
  return {
    id: r.id,
    creatorId: r.creator_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    headline: r.headline,
    whatWorking: r.what_working ?? [],
    whatNotWorking: r.what_not_working ?? [],
    themes: r.themes ?? [],
    sentiment: r.sentiment,
    model: r.model,
    promptVersion: r.prompt_version,
    createdAt: r.created_at,
  };
}

export function insightsRepo(tx: Tx) {
  return {
    async upsertCommentInsight(i: Omit<CommentInsight, "createdAt">): Promise<void> {
      await tx`
        insert into public.comment_insights
          (run_id, creator_id, sentiment_positive, sentiment_neutral, sentiment_negative,
           themes, comments_sampled, model)
        values (${i.runId}, ${i.creatorId}, ${i.positive}, ${i.neutral}, ${i.negative},
                ${tx.json(i.themes.map((t) => ({ ...t })))}, ${i.commentsSampled}, ${i.model})
        on conflict (run_id) do update set
          sentiment_positive = excluded.sentiment_positive,
          sentiment_neutral = excluded.sentiment_neutral,
          sentiment_negative = excluded.sentiment_negative,
          themes = excluded.themes, comments_sampled = excluded.comments_sampled,
          model = excluded.model
      `;
    },

    async latestCommentInsight(creatorId: string): Promise<CommentInsight | null> {
      const [r] = await tx<
        {
          run_id: string;
          creator_id: string;
          sentiment_positive: number;
          sentiment_neutral: number;
          sentiment_negative: number;
          themes: ThemeAggregate[];
          comments_sampled: number;
          model: string | null;
          created_at: Date;
        }[]
      >`
        select run_id, creator_id, sentiment_positive, sentiment_neutral, sentiment_negative,
               themes, comments_sampled, model, created_at
        from public.comment_insights where creator_id = ${creatorId}
        order by created_at desc limit 1
      `;
      if (!r) return null;
      return {
        runId: r.run_id,
        creatorId: r.creator_id,
        positive: r.sentiment_positive,
        neutral: r.sentiment_neutral,
        negative: r.sentiment_negative,
        themes: r.themes,
        commentsSampled: r.comments_sampled,
        model: r.model,
        createdAt: r.created_at,
      };
    },

    async upsertReport(r: Omit<Report, "id" | "createdAt">): Promise<void> {
      await tx`
        insert into public.reports
          (creator_id, period_start, period_end, headline, what_working, what_not_working,
           themes, sentiment, model, prompt_version)
        values (${r.creatorId}, ${r.periodStart}, ${r.periodEnd}, ${r.headline},
                ${tx.json(r.whatWorking.map((p) => ({ ...p })))},
                ${tx.json(r.whatNotWorking.map((p) => ({ ...p })))},
                ${tx.json(r.themes.map((t) => ({ ...t })))},
                ${r.sentiment ? tx.json({ ...r.sentiment }) : null},
                ${r.model}, ${r.promptVersion})
        on conflict (creator_id, period_start, period_end) do update set
          headline = excluded.headline, what_working = excluded.what_working,
          what_not_working = excluded.what_not_working, themes = excluded.themes,
          sentiment = excluded.sentiment, model = excluded.model,
          prompt_version = excluded.prompt_version, created_at = now()
      `;
    },

    async latestReport(creatorId: string): Promise<Report | null> {
      const [row] = await tx<ReportDbRow[]>`
        select id, creator_id, period_start, period_end, headline, what_working, what_not_working,
               themes, sentiment, model, prompt_version, created_at
        from public.reports where creator_id = ${creatorId}
        order by period_end desc, created_at desc limit 1
      `;
      return row ? toReport(row) : null;
    },

    async reportForPeriod(creatorId: string, periodStart: Date, periodEnd: Date): Promise<Report | null> {
      const [row] = await tx<ReportDbRow[]>`
        select id, creator_id, period_start, period_end, headline, what_working, what_not_working,
               themes, sentiment, model, prompt_version, created_at
        from public.reports
        where creator_id = ${creatorId} and period_start = ${periodStart} and period_end = ${periodEnd}
      `;
      return row ? toReport(row) : null;
    },
  };
}
