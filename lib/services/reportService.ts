import { MODELS } from "@/lib/ai/client";
import { getAiProvider } from "@/lib/ai/factory";
import type { AiProvider } from "@/lib/ai/provider";
import { reportOutputSchema, themesOutputSchema, type ThemesOutput } from "@/lib/ai/schemas";
import { generateStructured } from "@/lib/ai/structured";
import { recordAiCall } from "@/lib/ai/usage";
import type { AiResponse } from "@/lib/ai/provider";
import { asSystem, withRepos, type AiPurpose, type PostView } from "@/lib/repositories";
import type { Label } from "@/lib/scoring";
import * as reportPrompt from "@/prompts/report/system";
import * as themesPrompt from "@/prompts/themes/system";
import { mockReport, mockThemes } from "./mockAi";
import { londonIsoDate } from "./time";

/** The written report covers the last four weeks: enough posts to compare at 1-3 posts a day. */
export const REPORT_PERIOD_DAYS = 28;
const TOP_N = 5;

const MAX_TOKENS: Record<AiPurpose, number> = { themes: 800, report: 1400, plan: 2000 };

export interface AiContext {
  workspaceId: string;
  provider?: AiProvider;
}

/** Shared by the report and plan calls: logs every attempt to the cost ledger. */
export function ledgerFor(workspaceId: string, purpose: AiPurpose, model: string) {
  return async (a: { response: AiResponse | null; latencyMs: number; ok: boolean }) =>
    recordAiCall({ workspaceId, purpose, model, response: a.response, latencyMs: a.latencyMs, ok: a.ok });
}

export function maxTokensFor(purpose: AiPurpose): number {
  return MAX_TOKENS[purpose];
}

/** Scores are stored to 4 dp but shown to 2 dp (CLAUDE.md); the prose must quote what users see. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function toPromptPost(p: PostView): reportPrompt.ReportPostInput {
  return {
    format: p.format,
    postedOn: londonIsoDate(p.postedAt),
    caption: p.captionExcerpt ?? "",
    score: round2(p.score ?? 0),
    label: p.label ?? "too_early",
    rValues: Object.fromEntries(Object.entries(p.rValues).map(([k, v]) => [k, round2(v)])),
  };
}

/** Below this many posts in the period, the prompt gets the latest posts instead. */
const MIN_HISTORY_IN_PERIOD = 6;
const HISTORY_FALLBACK = 15;

/**
 * Every post the prose may cite, with raw counts, so the model can be specific even before
 * scores exist. Counts are copied, never derived: the model compares, software scores (D-045).
 */
export function promptHistory(
  posts: readonly PostView[],
  since: Date,
): { postsInPeriod: number; lastPostedOn: string | null; history: reportPrompt.HistoryPostInput[] } {
  const inPeriod = posts.filter((p) => p.postedAt >= since);
  const chosen = inPeriod.length >= MIN_HISTORY_IN_PERIOD ? inPeriod : posts.slice(0, HISTORY_FALLBACK);
  const newest = posts[0];
  return {
    postsInPeriod: inPeriod.length,
    lastPostedOn: newest ? londonIsoDate(newest.postedAt) : null,
    history: chosen.map((p) => ({
      format: p.format,
      postedOn: londonIsoDate(p.postedAt),
      caption: p.captionExcerpt ?? "",
      reach: p.reach,
      likes: p.likes,
      comments: p.comments,
      shares: p.shares,
      saves: p.saves,
      views: p.videoViews,
      avgWatchSeconds: p.avgWatchTimeMs === null ? null : Math.round(p.avgWatchTimeMs / 100) / 10,
      score: p.score === null ? null : round2(p.score),
      label: p.label ?? "not scored",
    })),
  };
}

/** Top and bottom scored posts from the period, as the prompts and the dashboard use them. */
export function topAndBottom(posts: readonly PostView[], since: Date): { top: PostView[]; bottom: PostView[] } {
  const scored = posts.filter((p) => p.score !== null && p.postedAt >= since);
  const desc = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const top = desc.slice(0, TOP_N);
  const topIds = new Set(top.map((p) => p.id));
  const bottom = [...desc].reverse().filter((p) => !topIds.has(p.id)).slice(0, TOP_N);
  return { top, bottom };
}

export async function generateThemes(
  ctx: AiContext,
  comments: readonly string[],
): Promise<{ output: ThemesOutput; model: string }> {
  const provider = ctx.provider ?? getAiProvider();
  const result = await generateStructured(themesOutputSchema, {
    provider,
    request: {
      purpose: "themes",
      model: MODELS.themes,
      system: themesPrompt.SYSTEM_PROMPT,
      user: themesPrompt.buildUserMessage(comments),
      maxTokens: MAX_TOKENS.themes,
      mockResponse: () => mockThemes(comments),
    },
    onAttempt: ledgerFor(ctx.workspaceId, "themes", MODELS.themes),
  });
  return { output: result.data, model: result.model };
}

export interface ReportRunInput {
  creatorId: string;
  username: string;
  runId: string;
  periodStart: Date;
  periodEnd: Date;
  posts: PostView[];
  labelCounts: Record<Label, number>;
  /** Sanitised sample; dropped by the caller as soon as this returns. */
  comments: readonly string[];
}

/**
 * Themes then report, one call each per run (§7). Writes comment_insights and reports.
 * Throws on AI failure; the run service catches and degrades.
 */
export async function generateReportForRun(ctx: AiContext, input: ReportRunInput): Promise<void> {
  const provider = ctx.provider ?? getAiProvider();

  let themes: ThemesOutput = { sentiment: { positive: 0, neutral: 0, negative: 0 }, themes: [] };
  let themesModel: string | null = null;
  if (input.comments.length > 0) {
    const t = await generateThemes({ ...ctx, provider }, input.comments);
    themes = t.output;
    themesModel = t.model;
  }

  const themeAggregates = themes.themes.map((t) => ({
    label: t.label,
    count: t.count,
    sentiment: t.sentiment,
    exampleParaphrase: t.example_paraphrase,
  }));

  await withRepos(asSystem(), (r) =>
    r.insights.upsertCommentInsight({
      runId: input.runId,
      creatorId: input.creatorId,
      positive: themes.sentiment.positive,
      neutral: themes.sentiment.neutral,
      negative: themes.sentiment.negative,
      themes: themeAggregates,
      commentsSampled: input.comments.length,
      model: themesModel,
    }),
  );

  const { top, bottom } = topAndBottom(input.posts, input.periodStart);
  const promptInput: reportPrompt.ReportInput = {
    username: input.username,
    periodLabel: `${londonIsoDate(input.periodStart)} to ${londonIsoDate(input.periodEnd)}`,
    ...promptHistory(input.posts, input.periodStart),
    labelCounts: input.labelCounts,
    top: top.map(toPromptPost),
    bottom: bottom.map(toPromptPost),
    themes: themeAggregates.map(({ label, count, sentiment }) => ({ label, count, sentiment })),
  };

  const report = await generateStructured(reportOutputSchema, {
    provider,
    request: {
      purpose: "report",
      model: MODELS.report,
      system: reportPrompt.SYSTEM_PROMPT,
      user: reportPrompt.buildUserMessage(promptInput),
      maxTokens: MAX_TOKENS.report,
      mockResponse: () => mockReport(promptInput),
    },
    onAttempt: ledgerFor(ctx.workspaceId, "report", MODELS.report),
  });

  await withRepos(asSystem(), (r) =>
    r.insights.upsertReport({
      creatorId: input.creatorId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      headline: report.data.headline,
      whatWorking: report.data.what_working,
      whatNotWorking: report.data.what_not_working,
      themes: themeAggregates,
      sentiment: themes.sentiment,
      model: report.model,
      promptVersion: reportPrompt.PROMPT_VERSION,
    }),
  );
}
