import { AppError, forbidden, notFound } from "@/lib/errors";
import {
  asUser,
  withRepos,
  type BaselineView,
  type CommentInsight,
  type Creator,
  type Membership,
  type PostCursor,
  type PostListFilter,
  type PostView,
  type Report,
  type Repos,
  type Role,
  type Run,
  type TrendPoint,
} from "@/lib/repositories";
import { MIN_BASELINE_POSTS, type Label, type PostFormat } from "@/lib/scoring";
import {
  ANALYTICS_PERIOD_DAYS,
  autoRange,
  buildAccountAnalytics,
  type AnalyticsRange,
  summarisePeriod,
  within,
  type AccountAnalytics,
  type PeriodSummary,
} from "./analytics";
import { topAndBottom } from "./reportService";
import { ingestCreator, type IngestResult } from "./runService";
import { intervalHours } from "./time";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CARD_TREND_POINTS = 12;

export interface WorkspaceContext extends Membership {
  userId: string;
}

/** v1: one workspace per user (the agency). The first membership is the active one. */
export async function getWorkspaceContext(userId: string): Promise<WorkspaceContext> {
  const memberships = await withRepos(asUser(userId), (r) => r.workspaces.membershipsForUser(userId));
  const first = memberships[0];
  if (!first) throw forbidden("Your account isn't linked to an agency yet. Ask an admin to invite you.");
  return { ...first, userId };
}

export interface CreatorCard {
  creator: Creator;
  latestRun: Run | null;
  /** Scores of the most recently scored posts, oldest first. */
  trend: number[];
  averageScore: number | null;
  /** The last 28 days and the 28 days before, for the portfolio summary. */
  period: PeriodSummary;
  previousPeriod: PeriodSummary;
}

export interface PortfolioSummary {
  accounts: number;
  current: PeriodSummary;
  previous: PeriodSummary;
  /** Accounts that need reconnecting or whose last update failed. */
  needsAttention: number;
}

export async function listCreatorCards(
  userId: string,
  now = new Date(),
): Promise<{ context: WorkspaceContext; cards: CreatorCard[]; portfolio: PortfolioSummary }> {
  const context = await getWorkspaceContext(userId);
  const periodStart = new Date(now.getTime() - ANALYTICS_PERIOD_DAYS * DAY_MS);
  const previousStart = new Date(periodStart.getTime() - ANALYTICS_PERIOD_DAYS * DAY_MS);
  const { cards, allPosts } = await withRepos(asUser(userId), async (r) => {
    const creators = await r.creators.listForWorkspace(context.workspaceId);
    const out: CreatorCard[] = [];
    const collected: { current: PostView[]; previous: PostView[] } = { current: [], previous: [] };
    for (const creator of creators) {
      const latestRun = await r.runs.latestFor(creator.id);
      const scored = await latestTrend(r, creator.id);
      const recent = scored.slice(-CARD_TREND_POINTS).map((p) => p.score);
      const posts = await r.posts.listViews(creator.id, { from: previousStart }, 200, null);
      const current = within(posts, periodStart, now);
      const previous = within(posts, previousStart, periodStart);
      collected.current.push(...current);
      collected.previous.push(...previous);
      out.push({
        creator,
        latestRun,
        trend: recent,
        averageScore: recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : null,
        period: summarisePeriod(current),
        previousPeriod: summarisePeriod(previous),
      });
    }
    return { cards: out, allPosts: collected };
  });
  const portfolio: PortfolioSummary = {
    accounts: cards.length,
    current: summarisePeriod(allPosts.current),
    previous: summarisePeriod(allPosts.previous),
    needsAttention: cards.filter((c) => c.creator.status === "needs_reauth" || c.latestRun?.status === "failed").length,
  };
  return { context, cards, portfolio };
}

async function latestTrend(r: Repos, creatorId: string): Promise<TrendPoint[]> {
  const run = await r.runs.latestSucceededFor(creatorId);
  return run ? r.scores.trendForRun(run.id) : [];
}

export interface BaselineGap {
  format: PostFormat;
  have: number;
  need: number;
}

export interface CreatorOverview {
  creator: Creator;
  role: Role;
  latestRun: Run | null;
  lastSucceededRun: Run | null;
  nextUpdateAt: Date | null;
  trend: TrendPoint[];
  top: PostView[];
  bottom: PostView[];
  baselines: BaselineView[];
  baselineGaps: BaselineGap[];
  labelCounts: Record<Label, number>;
  report: Report | null;
  /** True when the report was written from the latest successful run. */
  reportIsCurrent: boolean;
  insight: CommentInsight | null;
  /** Why AI sections are missing or stale, if they are. */
  aiNote: { code: string; message: string } | null;
  analytics: AccountAnalytics;
  /** True when the range was picked for the user because shorter ones were empty. */
  rangeIsAuto: boolean;
}

async function requireCreator(r: Repos, creatorId: string): Promise<Creator> {
  const creator = await r.creators.get(creatorId);
  // RLS hides other workspaces' creators: "not yours" is indistinguishable from "missing".
  if (!creator) throw notFound("That account");
  return creator;
}

/** Posts loaded for the account page: enough for a year at a busy creator's pace. */
const OVERVIEW_POST_LIMIT = 600;

export async function getOverview(
  userId: string,
  creatorId: string,
  now = new Date(),
  requestedRange: AnalyticsRange | null = null,
): Promise<CreatorOverview> {
  const context = await getWorkspaceContext(userId);
  return withRepos(asUser(userId), async (r) => {
    const creator = await requireCreator(r, creatorId);
    const settings = await r.workspaces.getSettings(creator.workspaceId);
    const latestRun = await r.runs.latestFor(creatorId);
    const lastSucceededRun = await r.runs.latestSucceededFor(creatorId);
    const trend = lastSucceededRun ? await r.scores.trendForRun(lastSucceededRun.id) : [];
    const labelCounts = lastSucceededRun
      ? await r.scores.labelCountsForRun(lastSucceededRun.id)
      : { strong: 0, normal: 0, weak: 0, too_early: 0, baseline_building: 0 };
    const posts = await r.posts.listViews(creatorId, {}, OVERVIEW_POST_LIMIT, null);
    const range = requestedRange ?? autoRange(posts, now);
    const { top, bottom } = topAndBottom(posts, new Date(now.getTime() - range * DAY_MS));
    const baselines = await r.scores.latestBaselines(creatorId);
    const report = await r.insights.latestReport(creatorId);
    const insight = await r.insights.latestCommentInsight(creatorId);

    const aiCode = lastSucceededRun?.errorCode;
    const aiNote =
      lastSucceededRun && aiCode && lastSucceededRun.errorMessage
        ? { code: aiCode, message: lastSucceededRun.errorMessage }
        : null;

    return {
      creator,
      role: context.role,
      latestRun,
      lastSucceededRun,
      nextUpdateAt:
        creator.lastSyncedAt && settings
          ? new Date(creator.lastSyncedAt.getTime() + intervalHours(settings.scheduleInterval) * HOUR_MS)
          : null,
      trend,
      top,
      bottom,
      baselines,
      baselineGaps: baselines
        .filter((b) => b.nPosts > 0 && b.nPosts < MIN_BASELINE_POSTS)
        .map((b) => ({ format: b.format, have: b.nPosts, need: MIN_BASELINE_POSTS - b.nPosts })),
      labelCounts,
      report,
      reportIsCurrent:
        report !== null &&
        lastSucceededRun !== null &&
        report.periodEnd.getTime() === lastSucceededRun.windowStart.getTime(),
      insight,
      aiNote,
      analytics: buildAccountAnalytics(posts, now, range),
      rangeIsAuto: requestedRange === null && range !== ANALYTICS_PERIOD_DAYS,
    };
  });
}

export const POSTS_PAGE_MAX = 100;

export async function listPosts(
  userId: string,
  creatorId: string,
  filter: PostListFilter,
  limit: number,
  cursor: PostCursor | null,
): Promise<{ items: PostView[]; nextCursor: PostCursor | null }> {
  const pageSize = Math.min(Math.max(limit, 1), POSTS_PAGE_MAX);
  return withRepos(asUser(userId), async (r) => {
    await requireCreator(r, creatorId);
    // Fetch one extra row to know whether another page exists.
    const rows = await r.posts.listViews(creatorId, filter, pageSize + 1, cursor);
    const items = rows.slice(0, pageSize);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: rows.length > pageSize && last ? { postedAt: last.postedAt, id: last.id } : null,
    };
  });
}

export async function getLatestReport(userId: string, creatorId: string): Promise<Report | null> {
  return withRepos(asUser(userId), async (r) => {
    await requireCreator(r, creatorId);
    return r.insights.latestReport(creatorId);
  });
}

/**
 * Manual "update now". Owners and admins only; the route layer rate-limits it. `deferAi`
 * lets the route return once scores are saved and write the summary afterwards (D-048).
 */
export async function requestManualRun(
  userId: string,
  creatorId: string,
  deferAi?: (task: () => Promise<void>) => void,
): Promise<IngestResult> {
  const context = await getWorkspaceContext(userId);
  await withRepos(asUser(userId), (r) => requireCreator(r, creatorId));
  if (context.role !== "owner" && context.role !== "admin") {
    throw forbidden("Only owners and admins can start an update.");
  }
  const result = await ingestCreator(creatorId, { trigger: "manual", deferAi });
  if (result.status === "skipped") {
    throw new AppError("CONFLICT", "An update for this account is already running.");
  }
  return result;
}
