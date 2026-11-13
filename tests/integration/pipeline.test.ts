import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProvider } from "@/lib/ai/provider";
import { closeDb } from "@/lib/db/client";
import { MockInstagramSource } from "@/lib/instagram/mock-source";
import { InstagramError } from "@/lib/instagram/types";
import { ingestCreator } from "@/lib/services/runService";
import { runWindowStart } from "@/lib/services/time";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
const HOUR_MS = 3_600_000;
const BASE = runWindowStart(new Date());
const at = (hours: number) => new Date(BASE.getTime() + hours * HOUR_MS + 5 * 60_000);

let creatorId = "";

async function counts(id: string) {
  const [row] = await sql<Record<string, number>[]>`
    select
      (select count(*)::int from posts where creator_id = ${id}) as posts,
      (select count(*)::int from post_metrics m join posts p on p.id = m.post_id where p.creator_id = ${id}) as metrics,
      (select count(*)::int from baselines where creator_id = ${id}) as baselines,
      (select count(*)::int from post_scores s join posts p on p.id = s.post_id where p.creator_id = ${id}) as scores,
      (select count(*)::int from comment_insights where creator_id = ${id}) as insights,
      (select count(*)::int from reports where creator_id = ${id}) as reports,
      (select count(*)::int from content_plans where creator_id = ${id}) as plans,
      (select count(*)::int from plan_suggestions s join content_plans c on c.id = s.plan_id where c.creator_id = ${id}) as suggestions,
      (select count(*)::int from runs where creator_id = ${id}) as runs
  `;
  return row ?? {};
}

async function scoresForRun(runId: string) {
  return sql<{ post_id: string; score: number | null; label: string }[]>`
    select post_id, score::float8 as score, label from post_scores where run_id = ${runId} order by post_id
  `;
}

beforeAll(async () => {
  const [row] = await sql<{ id: string }[]>`select id from creators where username = 'maya.cooks.uk'`;
  if (!row) throw new Error("seed did not create maya.cooks.uk");
  creatorId = row.id;
});

afterAll(async () => {
  await sql.end();
  await closeDb();
});

describe("ingestCreator against the mock source", () => {
  it("writes posts, metrics, baselines, scores, an insight, a report and a plan", async () => {
    const result = await ingestCreator(creatorId, { trigger: "manual", now: at(1) });
    expect(result).toMatchObject({ status: "succeeded", postsSeen: 40, aiNote: null });

    const c = await counts(creatorId);
    expect(c).toMatchObject({ posts: 40, insights: 1, reports: 1, plans: 1, suggestions: 7 });
    expect(c.metrics).toBeGreaterThanOrEqual(40);
    expect(c.baselines).toBeGreaterThanOrEqual(3);
    expect(c.scores).toBeGreaterThanOrEqual(40);
  });

  it("is idempotent: the same window twice gives identical scores and no duplicate rows", async () => {
    const first = await ingestCreator(creatorId, { trigger: "manual", now: at(2) });
    const before = await counts(creatorId);
    const second = await ingestCreator(creatorId, { trigger: "schedule", now: at(2) });
    const after = await counts(creatorId);

    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    if (first.status !== "succeeded" || second.status !== "succeeded") return;
    expect(second.runId).toBe(first.runId);
    expect(after).toEqual(before);
    expect(await scoresForRun(second.runId)).toEqual(await scoresForRun(first.runId));
  });

  it("applies new weights to the next run while old scores keep their snapshot", async () => {
    const [ws] = await sql<{ workspace_id: string }[]>`select workspace_id from creators where id = ${creatorId}`;
    const original = await sql`select weights from scoring_settings where workspace_id = ${ws?.workspace_id ?? ""}`;
    const before = await ingestCreator(creatorId, { trigger: "manual", now: at(3) });

    await sql`
      update scoring_settings
      set weights = '{"watch_time":0.05,"sends":0.05,"saves":0.05,"likes":0.80,"comments":0.05}'
      where workspace_id = ${ws?.workspace_id ?? ""}
    `;
    try {
      const after = await ingestCreator(creatorId, { trigger: "manual", now: at(4) });
      if (before.status !== "succeeded" || after.status !== "succeeded") throw new Error("runs failed");

      const oldScores = await scoresForRun(before.runId);
      const newScores = await scoresForRun(after.runId);
      expect(newScores).not.toEqual(oldScores);

      const [snap] = await sql<{ base: Record<string, number> }[]>`
        select weights_snapshot->'base' as base from post_scores s join posts p on p.id = s.post_id
        where s.run_id = ${before.runId} and p.format = 'reel' and s.score is not null limit 1
      `;
      expect(snap?.base.watch_time).toBe(0.35);
    } finally {
      await sql`update scoring_settings set weights = ${original[0]?.weights} where workspace_id = ${ws?.workspace_id ?? ""}`;
    }
  });

  it("stores scores but no report when the AI fails, and the run still succeeds", async () => {
    const broken: AiProvider = {
      name: "mock",
      complete: async () => {
        throw new Error("AI provider down");
      },
    };
    const result = await ingestCreator(creatorId, { trigger: "manual", now: at(5), ai: broken });
    expect(result).toMatchObject({ status: "succeeded", aiNote: "AI_FAILED" });
    if (result.status !== "succeeded") return;

    expect((await scoresForRun(result.runId)).length).toBe(40);
    const [run] = await sql`select status, error_code, error_message from runs where id = ${result.runId}`;
    expect(run).toMatchObject({ status: "succeeded", error_code: "AI_FAILED" });
    const [{ n } = { n: -1 }] = await sql<{ n: number }[]>`
      select count(*)::int as n from reports where creator_id = ${creatorId} and period_end = ${runWindowStart(at(5))}
    `;
    expect(n).toBe(0);
    const [{ failed } = { failed: 0 }] = await sql<{ failed: number }[]>`
      select count(*)::int as failed from ai_calls where ok = false
    `;
    expect(failed).toBeGreaterThan(0);
  });

  it("records a readable failure when Instagram is unavailable", async () => {
    const down = new MockInstagramSource({
      failWith: new InstagramError("Instagram returned 503", "UNAVAILABLE", true),
    });
    const result = await ingestCreator(creatorId, { trigger: "schedule", now: at(6), source: down });
    expect(result).toMatchObject({ status: "failed", errorCode: "INSTAGRAM_UNAVAILABLE" });
    if (result.status !== "failed") return;
    expect(result.errorMessage).toMatch(/^We couldn't reach Instagram at \d\d:\d\d\. We'll try again at \d\d:\d\d\.$/);

    const [run] = await sql`select status, error_code from runs where id = ${result.runId}`;
    expect(run).toMatchObject({ status: "failed", error_code: "INSTAGRAM_UNAVAILABLE" });
  });
});

describe("data minimisation", () => {
  it("has no column that could hold comment text or commenter usernames", async () => {
    const cols = await sql<{ table_name: string; column_name: string }[]>`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and (column_name ilike '%comment%' or column_name ilike '%username%')
      order by 1, 2
    `;
    // Only counts/aggregates, plus the creator's own handle.
    expect(cols.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
      "baselines.median_comments",
      "comment_insights.comments_sampled",
      "creators.username",
      "post_metrics.comments",
    ]);
  });

  it("does not persist any sampled comment, including the injection attempt", async () => {
    const [hit] = await sql<{ n: number }[]>`
      select count(*)::int as n from comment_insights
      where themes::text ilike '%ignore all previous instructions%' or themes::text ilike '%@jess_m%'
    `;
    expect(hit?.n).toBe(0);
  });
});
