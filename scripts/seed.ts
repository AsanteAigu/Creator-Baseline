/**
 * Seeds one demo workspace with 3 creators × 40 posts of deterministic fixtures.
 *
 * Re-runnable: the demo workspace has a fixed id and is deleted (cascading to every child
 * row) before being recreated, so reseeding never duplicates anything.
 *
 * Writes posts and one metrics snapshot per post under a bookkeeping run per creator.
 * It does not write baselines, scores, reports or plans — run `pnpm ingest` for those.
 *
 * Demo users (owner + viewer) are created in Supabase Auth when it is configured, otherwise
 * in the local auth shim. Password: SEED_DEMO_PASSWORD, or the local default below.
 */
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import {
  FIXTURE_CREATORS,
  generateCreatorPosts,
  type FixturePost,
} from "../lib/fixtures/creators";
import { requireDatabaseUrl } from "./env";

const DEMO_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_WORKSPACE_NAME = "Demo Agency";
const LOCAL_DEMO_PASSWORD = "creator-baseline-demo";
const DEMO_USERS = [
  { email: "owner@demo.agency", role: "owner" },
  { email: "viewer@demo.agency", role: "viewer" },
] as const;

/** Returns the auth user id for each demo email, creating users where needed. */
async function ensureDemoUsers(sql: postgres.Sql, password: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (url && serviceKey) {
    // Supabase Auth users must belong to the same project as the database being seeded:
    // a local database with live Supabase keys would put demo logins in the live project.
    if (!/supabase\.(co|com)/.test(process.env.DATABASE_URL ?? "")) {
      throw new Error("Refusing to seed: Supabase Auth is configured but DATABASE_URL is not a Supabase database.");
    }
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: existing, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (listError) throw listError;
    for (const u of DEMO_USERS) {
      const found = existing.users.find((x) => x.email === u.email);
      if (found) {
        ids.set(u.email, found.id);
        continue;
      }
      const { data, error } = await admin.auth.admin.createUser({ email: u.email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error(`could not create ${u.email}`);
      ids.set(u.email, data.user.id);
    }
    return ids;
  }

  for (const u of DEMO_USERS) {
    const [row] = await sql<{ id: string }[]>`
      insert into auth.users (email, encrypted_password)
      values (${u.email}, crypt(${password}, gen_salt('bf')))
      on conflict (email) do update set encrypted_password = excluded.encrypted_password
      returning id
    `;
    if (!row) throw new Error(`could not create ${u.email}`);
    ids.set(u.email, row.id);
  }
  return ids;
}

async function main(): Promise<void> {
  const sql = postgres(requireDatabaseUrl(), { max: 1, onnotice: () => {} });
  const now = new Date();
  // Truncated to the hour so the window lines up with the hourly scheduler's windows.
  const windowStart = new Date(now);
  windowStart.setUTCMinutes(0, 0, 0);

  try {
    const password = process.env.SEED_DEMO_PASSWORD?.trim() || LOCAL_DEMO_PASSWORD;
    const userIds = await ensureDemoUsers(sql, password);

    await sql.begin(async (tx) => {
      await tx`delete from public.workspaces where id = ${DEMO_WORKSPACE_ID}`;
      await tx`
        insert into public.workspaces (id, name)
        values (${DEMO_WORKSPACE_ID}, ${DEMO_WORKSPACE_NAME})
      `;
      // Column defaults hold the §5 scoring defaults.
      await tx`insert into public.scoring_settings (workspace_id) values (${DEMO_WORKSPACE_ID})`;
      for (const u of DEMO_USERS) {
        await tx`
          insert into public.workspace_members (workspace_id, user_id, role)
          values (${DEMO_WORKSPACE_ID}, ${userIds.get(u.email) ?? null}, ${u.role})
        `;
      }

      for (const fixture of FIXTURE_CREATORS) {
        const posts = generateCreatorPosts(fixture, now);

        const [creator] = await tx<{ id: string }[]>`
          insert into public.creators
            (workspace_id, ig_user_id, username, display_name, status, connected_at, last_synced_at)
          values
            (${DEMO_WORKSPACE_ID}, ${fixture.igUserId}, ${fixture.username}, ${fixture.displayName},
             'active', ${now}, ${now})
          returning id
        `;
        if (!creator) throw new Error(`failed to insert creator ${fixture.username}`);

        const [run] = await tx<{ id: string }[]>`
          insert into public.runs
            (creator_id, trigger, status, window_start, started_at, finished_at, posts_seen, posts_scored)
          values
            (${creator.id}, 'manual', 'succeeded', ${windowStart}, ${now}, ${now}, ${posts.length}, 0)
          returning id
        `;
        if (!run) throw new Error(`failed to insert seed run for ${fixture.username}`);

        await insertPosts(tx, creator.id, run.id, now, posts);
        console.log(`seeded ${fixture.username}: ${posts.length} posts (${summarise(posts)})`);
      }
    });
    console.log(`demo sign-in: ${DEMO_USERS.map((u) => `${u.email} (${u.role})`).join(", ")}`);
  } finally {
    await sql.end();
  }
}

async function insertPosts(
  tx: postgres.TransactionSql,
  creatorId: string,
  runId: string,
  capturedAt: Date,
  posts: FixturePost[],
): Promise<void> {
  const postRows = posts.map((p) => ({
    creator_id: creatorId,
    ig_media_id: p.igMediaId,
    format: p.format,
    permalink: p.permalink,
    posted_at: p.postedAt,
    caption_excerpt: p.captionExcerpt,
    duration_ms: p.durationMs,
  }));
  const inserted = await tx<{ id: string; ig_media_id: string }[]>`
    insert into public.posts ${tx(postRows)}
    returning id, ig_media_id
  `;
  const idByMedia = new Map(inserted.map((r) => [r.ig_media_id, r.id]));

  const metricRows = posts.map((p) => {
    const postId = idByMedia.get(p.igMediaId);
    if (!postId) throw new Error(`post ${p.igMediaId} was not inserted`);
    return {
      post_id: postId,
      run_id: runId,
      captured_at: capturedAt,
      reach: p.metrics.reach,
      likes: p.metrics.likes,
      comments: p.metrics.comments,
      shares: p.metrics.shares,
      saves: p.metrics.saves,
      avg_watch_time_ms: p.metrics.avgWatchTimeMs,
      video_views: p.metrics.videoViews,
    };
  });
  await tx`insert into public.post_metrics ${tx(metricRows)}`;
}

function summarise(posts: FixturePost[]): string {
  const counts = { reel: 0, carousel: 0, image: 0 };
  for (const p of posts) counts[p.format] += 1;
  return `${counts.reel} reels, ${counts.carousel} carousels, ${counts.image} images`;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
