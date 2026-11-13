import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { encryptToken } from "@/lib/instagram/crypto";
import { tokenKey } from "@/lib/instagram/keys";
import type { InstagramSource } from "@/lib/instagram/types";
import { deleteCreator, purgeExpired } from "@/lib/services/deletionService";

// Set before the first serverEnv() call; the shared test env has no encryption key.
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

let workspaceId = "";
let ownerId = "";
let viewerId = "";
let ownerA = "";
let demoWorkspaceId = "";
let mayaId = "";

function key(): Buffer {
  const k = tokenKey();
  if (k === null) throw new Error("test key missing");
  return k;
}

/** Only revokeToken is exercised by the purge path; anything else is a bug in the code under test. */
function fakeSource(revoked: string[]): InstagramSource {
  const unused = (): never => {
    throw new Error("not used by this test");
  };
  return {
    listRecentMedia: unused,
    getMediaInsights: unused,
    listComments: unused,
    authorizationUrl: unused,
    exchangeCode: unused,
    refreshToken: unused,
    revokeToken: async (token: string) => {
      revoked.push(token);
    },
  };
}

async function expectAppError(p: Promise<unknown>, code: AppError["code"]): Promise<void> {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

async function makeCreator(username: string, igUserId: string, token: string | null): Promise<string> {
  const encrypted = token === null ? null : encryptToken(token, key());
  const [row] = await sql<{ id: string }[]>`
    insert into public.creators
      (workspace_id, ig_user_id, username, display_name,
       access_token_ciphertext, token_iv, token_expires_at)
    values
      (${workspaceId}, ${igUserId}, ${username}, ${username},
       ${encrypted?.ciphertext ?? null}, ${encrypted?.iv ?? null},
       ${token === null ? null : new Date(Date.now() + 30 * DAY_MS)})
    returning id
  `;
  if (!row) throw new Error("creator insert failed");
  return row.id;
}

/** Every creator-owned row the schema cascades, so the purge test covers all of them. */
async function childCounts(creatorId: string): Promise<Record<string, number>> {
  const [row] = await sql<Record<string, number>[]>`
    select
      (select count(*)::int from public.runs where creator_id = ${creatorId}) as runs,
      (select count(*)::int from public.posts where creator_id = ${creatorId}) as posts,
      (select count(*)::int from public.post_metrics m
         join public.posts p on p.id = m.post_id where p.creator_id = ${creatorId}) as metrics,
      (select count(*)::int from public.baselines where creator_id = ${creatorId}) as baselines,
      (select count(*)::int from public.post_scores s
         join public.posts p on p.id = s.post_id where p.creator_id = ${creatorId}) as scores,
      (select count(*)::int from public.reports where creator_id = ${creatorId}) as reports,
      (select count(*)::int from public.comment_insights where creator_id = ${creatorId}) as insights,
      (select count(*)::int from public.content_plans where creator_id = ${creatorId}) as plans,
      (select count(*)::int from public.plan_suggestions s
         join public.content_plans c on c.id = s.plan_id where c.creator_id = ${creatorId}) as suggestions
  `;
  return row ?? {};
}

async function seedCreatorData(creatorId: string): Promise<void> {
  const [run] = await sql<{ id: string }[]>`
    insert into public.runs (creator_id, trigger, status, window_start, started_at, finished_at, posts_seen, posts_scored)
    values (${creatorId}, 'manual', 'succeeded', ${new Date()}, ${new Date()}, ${new Date()}, 1, 1)
    returning id
  `;
  if (!run) throw new Error("run insert failed");

  const [post] = await sql<{ id: string }[]>`
    insert into public.posts (creator_id, ig_media_id, format, permalink, posted_at)
    values (${creatorId}, ${`purge-${creatorId}`}, 'reel', 'https://example.test/p', ${new Date()})
    returning id
  `;
  if (!post) throw new Error("post insert failed");

  await sql`
    insert into public.post_metrics (post_id, run_id, reach, likes, comments, shares, saves)
    values (${post.id}, ${run.id}, 1000, 10, 1, 1, 1)
  `;
  await sql`
    insert into public.baselines (creator_id, run_id, format, n_posts, median_reach)
    values (${creatorId}, ${run.id}, 'reel', 30, 1000)
  `;
  await sql`
    insert into public.post_scores (post_id, run_id, score, label, weights_snapshot)
    values (${post.id}, ${run.id}, 1.0, 'normal', '{"base":{}}')
  `;
  await sql`
    insert into public.reports (creator_id, period_start, period_end, headline)
    values (${creatorId}, ${new Date(Date.now() - 7 * DAY_MS)}, ${new Date()}, 'Test report')
  `;
  await sql`
    insert into public.comment_insights (run_id, creator_id, themes)
    values (${run.id}, ${creatorId}, '[]')
  `;
  const [plan] = await sql<{ id: string }[]>`
    insert into public.content_plans (creator_id, week_start, summary)
    values (${creatorId}, ${new Date().toISOString().slice(0, 10)}, 'Test plan')
    returning id
  `;
  if (!plan) throw new Error("plan insert failed");
  await sql`
    insert into public.plan_suggestions (plan_id, title, format)
    values (${plan.id}, 'Test idea', 'reel')
  `;
}

beforeAll(async () => {
  const users = await sql<{ id: string; email: string }[]>`
    select id, email from auth.users where email = 'owner@demo.agency'
  `;
  ownerA = users[0]?.id ?? "";
  const [demoMembership] = await sql<{ workspace_id: string }[]>`
    select workspace_id from public.workspace_members where user_id = ${ownerA}
  `;
  demoWorkspaceId = demoMembership?.workspace_id ?? "";
  const [maya] = await sql<{ id: string }[]>`select id from public.creators where username = 'maya.cooks.uk'`;
  mayaId = maya?.id ?? "";

  const [owner] = await sql<{ id: string }[]>`
    insert into auth.users (email) values ('owner@purge.agency')
    on conflict (email) do update set email = excluded.email returning id
  `;
  ownerId = owner?.id ?? "";
  const [viewer] = await sql<{ id: string }[]>`
    insert into auth.users (email) values ('viewer@purge.agency')
    on conflict (email) do update set email = excluded.email returning id
  `;
  viewerId = viewer?.id ?? "";

  const [ws] = await sql<{ id: string }[]>`
    insert into public.workspaces (name) values ('Purge Agency') returning id
  `;
  workspaceId = ws?.id ?? "";
  await sql`insert into public.scoring_settings (workspace_id) values (${workspaceId})`;
  await sql`
    insert into public.workspace_members (workspace_id, user_id, role)
    values (${workspaceId}, ${ownerId}, 'owner'), (${workspaceId}, ${viewerId}, 'viewer')
  `;

  if (!ownerA || !demoWorkspaceId || !mayaId || !ownerId || !viewerId || !workspaceId) {
    throw new Error("purge fixtures incomplete");
  }
});

afterAll(async () => {
  await sql`delete from public.workspaces where id = ${workspaceId}`;
  await sql`delete from auth.users where email in ('owner@purge.agency', 'viewer@purge.agency')`;
  await sql.end();
  await closeDb();
});

describe("disconnect and purge", () => {
  it("removes every creator-owned row, records the deletion and revokes the token", async () => {
    const creatorId = await makeCreator("purge.one", "90000000000000001", "purge-secret-token");
    await seedCreatorData(creatorId);
    expect(await childCounts(creatorId)).toMatchObject({ runs: 1, posts: 1, metrics: 1, scores: 1, plans: 1 });

    const revoked: string[] = [];
    await deleteCreator(ownerId, creatorId, { source: fakeSource(revoked) });

    const [creator] = await sql`select id from public.creators where id = ${creatorId}`;
    expect(creator).toBeUndefined();
    expect(await childCounts(creatorId)).toEqual({
      runs: 0,
      posts: 0,
      metrics: 0,
      baselines: 0,
      scores: 0,
      reports: 0,
      insights: 0,
      plans: 0,
      suggestions: 0,
    });

    expect(revoked).toEqual(["purge-secret-token"]);

    const [request] = await sql<{ creator_id: string; completed_at: Date | null }[]>`
      select creator_id, completed_at from public.deletion_requests
      where workspace_id = ${workspaceId} and creator_id = ${creatorId}
      order by requested_at desc limit 1
    `;
    expect(request?.creator_id).toBe(creatorId);
    expect(request?.completed_at).not.toBeNull();

    const [audit] = await sql<{ action: string; actor_user_id: string; subject: string }[]>`
      select action, actor_user_id, subject from public.audit_log
      where workspace_id = ${workspaceId} and action = 'creator.deleted' and subject = ${creatorId}
    `;
    expect(audit).toMatchObject({ action: "creator.deleted", actor_user_id: ownerId, subject: creatorId });
  });

  it("refuses a viewer and a member of another workspace, leaving the creator intact", async () => {
    const creatorId = await makeCreator("purge.guarded", "90000000000000002", null);

    await expectAppError(deleteCreator(viewerId, creatorId), "FORBIDDEN");
    await expectAppError(deleteCreator(ownerA, creatorId), "NOT_FOUND");

    const [row] = await sql`select id from public.creators where id = ${creatorId}`;
    expect(row?.id ?? null).toBe(creatorId);
    expect(mayaId).not.toBe(creatorId);
  });

  it("checks the role in the creator's own workspace, not the caller's first workspace", async () => {
    // The purge owner is a viewer in the demo workspace; ownership of another workspace
    // must not authorise deleting this creator.
    await sql`
      insert into public.workspace_members (workspace_id, user_id, role)
      values (${demoWorkspaceId}, ${ownerId}, 'viewer')
    `;
    try {
      await expectAppError(deleteCreator(ownerId, mayaId), "FORBIDDEN");
    } finally {
      await sql`
        delete from public.workspace_members
        where workspace_id = ${demoWorkspaceId} and user_id = ${ownerId}
      `;
    }

    const [row] = await sql`select id from public.creators where id = ${mayaId}`;
    expect(row?.id ?? null).toBe(mayaId);
  });

  it("reports a creator that is already gone as not found", async () => {
    const creatorId = await makeCreator("purge.twice", "90000000000000003", null);
    await deleteCreator(ownerId, creatorId);
    await expectAppError(deleteCreator(ownerId, creatorId), "NOT_FOUND");
  });
});

describe("daily housekeeping", () => {
  it("fails stranded runs and finishes incomplete deletion requests", async () => {
    const pending = await makeCreator("purge.pending", "90000000000000004", null);
    const stranded = await makeCreator("purge.stranded", "90000000000000005", null);

    await sql`
      insert into public.deletion_requests (workspace_id, creator_id, requested_at, completed_at)
      values (${workspaceId}, ${pending}, ${new Date(Date.now() - DAY_MS)}, null)
    `;
    await sql`
      insert into public.runs (creator_id, trigger, status, window_start, started_at)
      values (${stranded}, 'schedule', 'running', ${new Date(Date.now() - 2 * HOUR_MS)}, ${new Date(Date.now() - 2 * HOUR_MS)})
    `;

    const result = await purgeExpired(new Date(), fakeSource([]));

    expect(result.deletionsCompleted).toBeGreaterThanOrEqual(1);
    expect(result.orphansFailed).toBeGreaterThanOrEqual(1);

    const [gone] = await sql`select id from public.creators where id = ${pending}`;
    expect(gone).toBeUndefined();

    const [request] = await sql<{ completed_at: Date | null }[]>`
      select completed_at from public.deletion_requests
      where workspace_id = ${workspaceId} and creator_id = ${pending}
    `;
    expect(request?.completed_at).not.toBeNull();

    const [run] = await sql<{ status: string; error_code: string | null }[]>`
      select status, error_code from public.runs where creator_id = ${stranded}
    `;
    expect(run).toMatchObject({ status: "failed", error_code: "ORPHANED" });

    await deleteCreator(ownerId, stranded);
  });
});
