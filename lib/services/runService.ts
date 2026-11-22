import type { AiProvider } from "@/lib/ai/provider";
import { budgetStatus } from "@/lib/ai/usage";
import { notFound } from "@/lib/errors";
import { createInstagramSource } from "@/lib/instagram/factory";
import { captionExcerpt, isScorableMedia, toPostFormat } from "@/lib/instagram/metrics";
import {
  InstagramError,
  type InstagramCreator,
  type InstagramSource,
  type RawInsights,
  type RawMedia,
} from "@/lib/instagram/types";
import { asSystem, withRepos, type RunTrigger } from "@/lib/repositories";
import { sampleComments, MAX_SAMPLED_COMMENTS } from "./commentSample";
import { ensureWeekPlan } from "./planService";
import { REPORT_PERIOD_DAYS, generateReportForRun } from "./reportService";
import { scoreCreator, settingsToConfig } from "./scoringService";
import { intervalHours, runWindowStart } from "./time";
import { resolveAccessToken } from "./tokenService";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/**
 * How far back media is listed: a year, so a creator who posts rarely still has enough
 * history for a baseline (D-045). Listing is cheap; insights are the per-post cost.
 */
const LOOKBACK_DAYS = 365;
/** Insights are re-read only while they still move; older posts are read once (D-045). */
const INSIGHTS_REFRESH_DAYS = 120;
/** Older posts read per run, so a large account's first year is spread over a few runs. */
const BACKFILL_PER_RUN = 60;
/** Comments are sampled from the last fortnight of posts. */
const COMMENT_LOOKBACK_DAYS = 14;
/** With nothing posted in the fortnight, comments come from this many latest posts. */
const COMMENT_FALLBACK_POSTS = 10;
const ORPHAN_AFTER_MS = 30 * 60 * 1000;

export interface IngestOptions {
  trigger: RunTrigger;
  now?: Date;
  /** Injected in tests; production uses the env-selected implementations. */
  source?: InstagramSource;
  ai?: AiProvider;
}

export type IngestResult =
  | { status: "succeeded"; runId: string; postsSeen: number; postsScored: number; aiNote: string | null }
  | { status: "failed"; runId: string; errorCode: string; errorMessage: string }
  | { status: "skipped"; reason: "already_running" };

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

function instagramFailureMessage(now: Date, everyHours: number): string {
  const next = new Date(now.getTime() + everyHours * HOUR_MS);
  return `We couldn't reach Instagram at ${timeFmt.format(now)}. We'll try again at ${timeFmt.format(next)}.`;
}

/**
 * The ingestion pipeline (SPECIFICATION §8), idempotent per (creator, hour window):
 * upsert posts -> fetch insights -> append metrics -> baselines -> score -> themes -> report
 * -> plan. Instagram failure fails the run with a readable message; AI failure never does.
 */
export async function ingestCreator(creatorId: string, opts: IngestOptions): Promise<IngestResult> {
  const now = opts.now ?? new Date();
  const source = opts.source ?? createInstagramSource();

  const setup = await withRepos(asSystem(), async (r) => {
    await r.runs.failOrphans(new Date(now.getTime() - ORPHAN_AFTER_MS), now);
    const creator = await r.creators.get(creatorId);
    if (!creator) throw notFound("Creator");
    const settings = await r.workspaces.getSettings(creator.workspaceId);
    if (!settings) throw new Error(`workspace ${creator.workspaceId} has no scoring settings`);
    const run = await r.runs.claim(creatorId, opts.trigger, runWindowStart(now), now);
    return { creator, settings, run };
  });
  if (!setup.run) return { status: "skipped", reason: "already_running" };

  const { creator, settings, run } = setup;
  const config = settingsToConfig(settings);
  const igCreator: InstagramCreator = {
    id: creator.id,
    igUserId: creator.igUserId,
    connectedAt: creator.connectedAt,
    // Decrypted (and refreshed when close to expiry) for real accounts; null in mock mode.
    accessToken: null,
  };

  // 1-3. Fetch from Instagram. Sequential on purpose: at most one in-flight request per creator.
  let postsSeen = 0;
  try {
    igCreator.accessToken = await resolveAccessToken(creator.id, source, now);
    const media = (await source.listRecentMedia(igCreator, new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS))).filter(
      isScorableMedia,
    );
    postsSeen = media.length;
    const known = await withRepos(asSystem(), (r) => r.posts.knownMediaIds(creator.id));
    const refreshFrom = now.getTime() - INSIGHTS_REFRESH_DAYS * DAY_MS;
    const insights: { media: RawMedia; metrics: RawInsights }[] = [];
    let backfilled = 0;
    for (const m of media) {
      const old = m.timestamp.getTime() < refreshFrom;
      if (old && known.has(m.id)) continue;
      if (old && backfilled >= BACKFILL_PER_RUN) continue;
      if (old) backfilled += 1;
      try {
        insights.push({ media: m, metrics: await source.getMediaInsights(igCreator, m) });
      } catch (err) {
        // Insights can lag by up to 48 hours; a post without them is picked up by a later
        // run. A missing metric inside a present payload still fails loudly (D-025).
        if (err instanceof InstagramError && err.code === "NO_DATA") continue;
        throw err;
      }
    }

    await withRepos(asSystem(), async (r) => {
      const ids = await r.posts.upsertMany(
        creator.id,
        media.map((m) => ({
          igMediaId: m.id,
          format: toPostFormat(m),
          permalink: m.permalink,
          postedAt: m.timestamp,
          captionExcerpt: captionExcerpt(m.caption),
          durationMs: m.durationMs,
        })),
      );
      await r.posts.appendMetrics(
        run.id,
        now,
        insights.flatMap(({ media: m, metrics }) => {
          const postId = ids.get(m.id);
          return postId ? [{ postId, ...metrics }] : [];
        }),
      );
    });
  } catch (err) {
    const isIg = err instanceof InstagramError;
    const code = isIg ? `INSTAGRAM_${err.code}` : "INTERNAL";
    // AUTH messages say what to fix (reconnect, or a missing permission); retrying on schedule
    // won't help, so "we'll try again" would mislead. They never carry a token.
    const message = isIg
      ? err.code === "AUTH"
        ? err.message
        : instagramFailureMessage(now, intervalHours(settings.scheduleInterval))
      : "Something went wrong while updating this account. We'll try again on the next scheduled update.";
    if (isIg && err.code === "AUTH") {
      await withRepos(asSystem(), (r) => r.creators.setStatus(creator.id, "needs_reauth"));
    }
    await withRepos(asSystem(), (r) => r.runs.fail(run.id, now, code, message));
    return { status: "failed", runId: run.id, errorCode: code, errorMessage: message };
  }

  // 4-5. Deterministic scoring. A failure here is a real bug: record it and rethrow.
  let postsScored = 0;
  try {
    postsScored = await withRepos(asSystem(), async (r) => {
      const { scored } = await scoreCreator(r, creator.id, run.id, config, now);
      return scored;
    });
  } catch (err) {
    await withRepos(asSystem(), (r) =>
      r.runs.fail(run.id, now, "SCORING_FAILED", "Scores could not be calculated for this update."),
    );
    throw err;
  }

  // 6-8. AI: themes, report, plan. Degrades, never fails the run.
  const aiNote = await runAiSteps({
    creatorId: creator.id,
    username: creator.username,
    workspaceId: creator.workspaceId,
    budgetUsd: settings.aiMonthlyBudgetUsd,
    runId: run.id,
    windowStart: run.windowStart,
    now,
    source,
    igCreator,
    ai: opts.ai,
  });

  await withRepos(asSystem(), async (r) => {
    await r.runs.succeed(run.id, now, postsSeen, postsScored, aiNote);
    await r.creators.markSynced(creator.id, now);
    // A run that reached Instagram proves the token works again.
    if (creator.status === "needs_reauth") await r.creators.setStatus(creator.id, "active");
  });

  return { status: "succeeded", runId: run.id, postsSeen, postsScored, aiNote: aiNote?.code ?? null };
}

async function runAiSteps(input: {
  creatorId: string;
  username: string;
  workspaceId: string;
  budgetUsd: number;
  runId: string;
  windowStart: Date;
  now: Date;
  source: InstagramSource;
  igCreator: InstagramCreator;
  ai: AiProvider | undefined;
}): Promise<{ code: string; message: string } | null> {
  const budget = await budgetStatus(input.workspaceId, input.budgetUsd, input.now);
  if (budget.exhausted) {
    return { code: "AI_BUDGET", message: "AI summaries paused — monthly budget reached." };
  }

  const ctx = { workspaceId: input.workspaceId, provider: input.ai };
  try {
    const {
      posts,
      labelCounts,
      mediaIds: fortnight,
    } = await withRepos(asSystem(), async (r) => ({
      posts: await r.posts.listViews(input.creatorId, {}, 200, null),
      labelCounts: await r.scores.labelCountsForRun(input.runId),
      mediaIds: await r.posts.recentMediaIds(
        input.creatorId,
        new Date(input.now.getTime() - COMMENT_LOOKBACK_DAYS * DAY_MS),
      ),
    }));

    // A creator who hasn't posted lately still has an audience worth reading: fall back to
    // the latest posts, so themes don't go blank after a quiet fortnight (D-045).
    const mediaIds = fortnight.length > 0 ? fortnight : posts.slice(0, COMMENT_FALLBACK_POSTS).map((p) => p.igMediaId);

    // Comments live only in this scope; nothing but the model's aggregates is persisted.
    const raw: string[] = [];
    for (const id of mediaIds) {
      if (raw.length >= MAX_SAMPLED_COMMENTS * 2) break;
      const batch = await input.source.listComments(input.igCreator, id, MAX_SAMPLED_COMMENTS);
      for (const c of batch) raw.push(c.text);
    }
    const comments = sampleComments(raw);

    await generateReportForRun(ctx, {
      creatorId: input.creatorId,
      username: input.username,
      runId: input.runId,
      periodStart: new Date(input.windowStart.getTime() - REPORT_PERIOD_DAYS * DAY_MS),
      periodEnd: input.windowStart,
      posts,
      labelCounts,
      comments,
    });
    await ensureWeekPlan(ctx, input.creatorId, input.now);
    return null;
  } catch (err) {
    // Log the class of failure only: messages could echo prompt content.
    console.error(
      `[ingest] AI step failed for creator ${input.creatorId}: ${err instanceof Error ? err.name : "unknown"}`,
    );
    return {
      code: "AI_FAILED",
      message: "The written summary couldn't be generated this time. Scores are up to date.",
    };
  }
}
