import type { Tx } from "@/lib/db/client";
import type { Label, MetricSnapshot, PostFormat, ScorablePost } from "@/lib/scoring";

export interface PostUpsert {
  igMediaId: string;
  format: PostFormat;
  permalink: string | null;
  postedAt: Date;
  captionExcerpt: string | null;
  durationMs: number | null;
}

export interface MetricsAppend {
  postId: string;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  avgWatchTimeMs: number | null;
  videoViews: number | null;
}

/** A post as the dashboard shows it: latest metrics and latest score. */
export interface PostView {
  id: string;
  igMediaId: string;
  format: PostFormat;
  permalink: string | null;
  postedAt: Date;
  captionExcerpt: string | null;
  reach: number | null;
  score: number | null;
  label: Label | null;
  rValues: Record<string, number>;
}

export interface PostListFilter {
  label?: Label;
  format?: PostFormat;
  from?: Date;
  to?: Date;
}

/** Keyset cursor: (posted_at, id) of the last row of the previous page. */
export interface PostCursor {
  postedAt: Date;
  id: string;
}

interface PostViewDbRow {
  id: string;
  ig_media_id: string;
  format: PostFormat;
  permalink: string | null;
  posted_at: Date;
  caption_excerpt: string | null;
  reach: number | null;
  score: number | null;
  label: Label | null;
  r_values: Record<string, number> | null;
}

function toPostView(r: PostViewDbRow): PostView {
  return {
    id: r.id,
    igMediaId: r.ig_media_id,
    format: r.format,
    permalink: r.permalink,
    postedAt: r.posted_at,
    captionExcerpt: r.caption_excerpt,
    reach: r.reach,
    score: r.score,
    label: r.label,
    rValues: r.r_values ?? {},
  };
}

export function postsRepo(tx: Tx) {
  return {
    /** Idempotent on ig_media_id. Returns ig_media_id -> post id. */
    async upsertMany(creatorId: string, posts: PostUpsert[]): Promise<Map<string, string>> {
      if (posts.length === 0) return new Map();
      const rows = posts.map((p) => ({
        creator_id: creatorId,
        ig_media_id: p.igMediaId,
        format: p.format,
        permalink: p.permalink,
        posted_at: p.postedAt,
        caption_excerpt: p.captionExcerpt,
        duration_ms: p.durationMs,
      }));
      // The WHERE stops a media id that belongs to another creator from being hijacked.
      const result = await tx<{ id: string; ig_media_id: string }[]>`
        insert into public.posts ${tx(rows)}
        on conflict (ig_media_id) do update set
          permalink = excluded.permalink,
          caption_excerpt = excluded.caption_excerpt,
          duration_ms = excluded.duration_ms
        where posts.creator_id = excluded.creator_id
        returning id, ig_media_id
      `;
      return new Map(result.map((r) => [r.ig_media_id, r.id]));
    },

    /** Append-only; a second append for the same (post, run) is ignored. */
    async appendMetrics(runId: string, capturedAt: Date, metrics: MetricsAppend[]): Promise<number> {
      if (metrics.length === 0) return 0;
      const rows = metrics.map((m) => ({
        post_id: m.postId,
        run_id: runId,
        captured_at: capturedAt,
        reach: m.reach,
        likes: m.likes,
        comments: m.comments,
        shares: m.shares,
        saves: m.saves,
        avg_watch_time_ms: m.avgWatchTimeMs,
        video_views: m.videoViews,
      }));
      const inserted = await tx`
        insert into public.post_metrics ${tx(rows)}
        on conflict (post_id, run_id) do nothing
        returning id
      `;
      return inserted.length;
    },

    /** Every post of a creator with its latest snapshot, ready for lib/scoring. */
    async listScorable(creatorId: string): Promise<ScorablePost[]> {
      const rows = await tx<
        {
          id: string;
          format: PostFormat;
          posted_at: Date;
          duration_ms: number | null;
          reach: number | null;
          likes: number | null;
          comments: number | null;
          shares: number | null;
          saves: number | null;
          avg_watch_time_ms: number | null;
        }[]
      >`
        select p.id, p.format, p.posted_at, p.duration_ms,
               m.reach, m.likes, m.comments, m.shares, m.saves, m.avg_watch_time_ms
        from public.posts p
        left join lateral (
          select * from public.post_metrics pm
          where pm.post_id = p.id
          order by pm.captured_at desc
          limit 1
        ) m on true
        where p.creator_id = ${creatorId}
        order by p.posted_at desc
      `;
      return rows.map((r) => {
        const metrics: MetricSnapshot | null =
          r.reach === null
            ? null
            : {
                reach: r.reach,
                likes: r.likes ?? 0,
                comments: r.comments ?? 0,
                shares: r.shares ?? 0,
                saves: r.saves ?? 0,
                avgWatchTimeMs: r.avg_watch_time_ms,
              };
        return { id: r.id, format: r.format, postedAt: r.posted_at, durationMs: r.duration_ms, metrics };
      });
    },

    /** Media ids posted since a date, newest first — the comment sample is drawn from these. */
    async recentMediaIds(creatorId: string, since: Date): Promise<string[]> {
      const rows = await tx<{ ig_media_id: string }[]>`
        select ig_media_id from public.posts
        where creator_id = ${creatorId} and posted_at >= ${since}
        order by posted_at desc
      `;
      return rows.map((r) => r.ig_media_id);
    },

    /** Latest score per post, newest first, keyset-paginated. */
    async listViews(
      creatorId: string,
      filter: PostListFilter,
      limit: number,
      cursor: PostCursor | null,
    ): Promise<PostView[]> {
      const rows = await tx<PostViewDbRow[]>`
        select * from (
          select p.id, p.ig_media_id, p.format, p.permalink, p.posted_at, p.caption_excerpt,
                 m.reach, s.score, s.label, s.r_values
          from public.posts p
          left join lateral (
            select reach from public.post_metrics pm
            where pm.post_id = p.id order by pm.captured_at desc limit 1
          ) m on true
          left join lateral (
            select score, label, r_values from public.post_scores ps
            where ps.post_id = p.id order by ps.computed_at desc limit 1
          ) s on true
          where p.creator_id = ${creatorId}
        ) v
        where (${filter.label ?? null}::text is null or v.label = ${filter.label ?? null})
          and (${filter.format ?? null}::text is null or v.format = ${filter.format ?? null})
          and (${filter.from ?? null}::timestamptz is null or v.posted_at >= ${filter.from ?? null})
          and (${filter.to ?? null}::timestamptz is null or v.posted_at < ${filter.to ?? null})
          and (${cursor?.postedAt ?? null}::timestamptz is null
               or (v.posted_at, v.id) < (${cursor?.postedAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        order by v.posted_at desc, v.id desc
        limit ${limit}
      `;
      return rows.map(toPostView);
    },
  };
}
