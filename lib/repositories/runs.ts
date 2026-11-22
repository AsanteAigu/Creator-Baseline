import type { Tx } from "@/lib/db/client";
import type { CreatorStatus } from "./creators";

export type RunStatus = "queued" | "running" | "succeeded" | "failed";
export type RunTrigger = "schedule" | "manual";

export interface Run {
  id: string;
  creatorId: string;
  trigger: RunTrigger;
  status: RunStatus;
  windowStart: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  postsSeen: number;
  postsScored: number;
}

interface RunDbRow {
  id: string;
  creator_id: string;
  trigger: RunTrigger;
  status: RunStatus;
  window_start: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error_code: string | null;
  error_message: string | null;
  posts_seen: number;
  posts_scored: number;
}

function toRun(r: RunDbRow): Run {
  return {
    id: r.id,
    creatorId: r.creator_id,
    trigger: r.trigger,
    status: r.status,
    windowStart: r.window_start,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    postsSeen: r.posts_seen,
    postsScored: r.posts_scored,
  };
}

const COLUMNS = `id, creator_id, trigger, status, window_start, started_at, finished_at,
                 error_code, error_message, posts_seen, posts_scored`;

export function runsRepo(tx: Tx) {
  return {
    /**
     * Claims the run for (creator, window). Returns null when another invocation is already
     * running it, so two workers never process the same window at once.
     */
    async claim(creatorId: string, trigger: RunTrigger, windowStart: Date, now: Date): Promise<Run | null> {
      const [row] = await tx<RunDbRow[]>`
        insert into public.runs (creator_id, trigger, status, window_start, started_at)
        values (${creatorId}, ${trigger}, 'running', ${windowStart}, ${now})
        on conflict (creator_id, window_start) do update set
          status = 'running', trigger = excluded.trigger, started_at = excluded.started_at,
          finished_at = null, error_code = null, error_message = null
        where runs.status <> 'running'
        returning ${tx.unsafe(COLUMNS)}
      `;
      return row ? toRun(row) : null;
    },

    /**
     * A run whose AI step degraded still succeeds (§7); the note records why the written
     * summary is missing so the dashboard can say so and offer a retry.
     */
    async succeed(
      runId: string,
      now: Date,
      postsSeen: number,
      postsScored: number,
      note: { code: string; message: string } | null = null,
    ): Promise<void> {
      await tx`
        update public.runs set status = 'succeeded', finished_at = ${now},
          posts_seen = ${postsSeen}, posts_scored = ${postsScored},
          error_code = ${note?.code ?? null}, error_message = ${note?.message ?? null}
        where id = ${runId}
      `;
    },

    async fail(runId: string, now: Date, code: string, message: string): Promise<void> {
      await tx`
        update public.runs set status = 'failed', finished_at = ${now},
          error_code = ${code}, error_message = ${message}
        where id = ${runId}
      `;
    },

    /** Never leave a run stuck in `running` (§8): anything older than the cutoff failed. */
    async failOrphans(olderThan: Date, now: Date): Promise<number> {
      const rows = await tx`
        update public.runs set status = 'failed', finished_at = ${now},
          error_code = 'ORPHANED', error_message = 'The update stopped before finishing.'
        where status = 'running' and started_at < ${olderThan}
        returning id
      `;
      return rows.length;
    },

    async latestFor(creatorId: string): Promise<Run | null> {
      const [row] = await tx<RunDbRow[]>`
        select ${tx.unsafe(COLUMNS)} from public.runs
        where creator_id = ${creatorId}
        order by started_at desc nulls last
        limit 1
      `;
      return row ? toRun(row) : null;
    },

    async latestSucceededFor(creatorId: string): Promise<Run | null> {
      const [row] = await tx<RunDbRow[]>`
        select ${tx.unsafe(COLUMNS)} from public.runs
        where creator_id = ${creatorId} and status = 'succeeded'
        order by started_at desc nulls last
        limit 1
      `;
      return row ? toRun(row) : null;
    },

    /** Health view: one row per creator in a workspace, with its latest run if any. */
    async latestForWorkspace(
      workspaceId: string,
    ): Promise<{ creatorId: string; username: string; creatorStatus: CreatorStatus; run: Run | null }[]> {
      const rows = await tx<
        {
          creator_id: string;
          username: string;
          creator_status: CreatorStatus;
          run_id: string | null;
          trigger: RunTrigger | null;
          status: RunStatus | null;
          window_start: Date | null;
          started_at: Date | null;
          finished_at: Date | null;
          error_code: string | null;
          error_message: string | null;
          posts_seen: number | null;
          posts_scored: number | null;
        }[]
      >`
        select c.id as creator_id, c.username, c.status as creator_status,
               r.id as run_id, r.trigger, r.status, r.window_start, r.started_at, r.finished_at,
               r.error_code, r.error_message, r.posts_seen, r.posts_scored
        from public.creators c
        left join lateral (
          select * from public.runs where creator_id = c.id
          order by started_at desc nulls last limit 1
        ) r on true
        where c.workspace_id = ${workspaceId}
        order by c.username
      `;
      return rows.map((r) => ({
        creatorId: r.creator_id,
        username: r.username,
        creatorStatus: r.creator_status,
        run:
          r.run_id === null || r.trigger === null || r.status === null || r.window_start === null
            ? null
            : {
                id: r.run_id,
                creatorId: r.creator_id,
                trigger: r.trigger,
                status: r.status,
                windowStart: r.window_start,
                startedAt: r.started_at,
                finishedAt: r.finished_at,
                errorCode: r.error_code,
                errorMessage: r.error_message,
                postsSeen: r.posts_seen ?? 0,
                postsScored: r.posts_scored ?? 0,
              },
      }));
    },
  };
}
