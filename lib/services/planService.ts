import { MODELS } from "@/lib/ai/client";
import { getAiProvider } from "@/lib/ai/factory";
import { planOutputSchema } from "@/lib/ai/schemas";
import { generateStructured } from "@/lib/ai/structured";
import { budgetStatus } from "@/lib/ai/usage";
import { AppError, forbidden, notFound } from "@/lib/errors";
import {
  asSystem,
  asUser,
  withRepos,
  type Plan,
  type Suggestion,
  type SuggestionStatus,
} from "@/lib/repositories";
import * as planPrompt from "@/prompts/plan/system";
import { mockPlan } from "./mockAi";
import { REPORT_PERIOD_DAYS, ledgerFor, maxTokensFor, toPromptPost, topAndBottom, type AiContext } from "./reportService";
import { weekDates, weekStartLondon } from "./time";

export const IDEAS_PER_WEEK = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Generates (or refreshes in place) the week's plan for one creator. System scope. */
export async function generateWeekPlan(ctx: AiContext, creatorId: string, now: Date): Promise<void> {
  const weekStart = weekStartLondon(now);
  const since = new Date(now.getTime() - REPORT_PERIOD_DAYS * DAY_MS);

  const data = await withRepos(asSystem(), async (r) => {
    const creator = await r.creators.get(creatorId);
    if (!creator) throw notFound("Creator");
    const posts = await r.posts.listViews(creatorId, {}, 200, null);
    const insight = await r.insights.latestCommentInsight(creatorId);
    const decided = await r.plans.recentDecided(creatorId, 20);
    return { creator, posts, insight, decided };
  });

  const { top, bottom } = topAndBottom(data.posts, since);
  const input: planPrompt.PlanInput = {
    username: data.creator.username,
    weekStart,
    weekDates: weekDates(weekStart),
    top: top.map(toPromptPost),
    bottom: bottom.map(toPromptPost),
    themes: (data.insight?.themes ?? []).map(({ label, count, sentiment }) => ({ label, count, sentiment })),
    decided: data.decided,
  };

  const result = await generateStructured(planOutputSchema, {
    provider: ctx.provider ?? getAiProvider(),
    request: {
      purpose: "plan",
      model: MODELS.plan,
      system: planPrompt.SYSTEM_PROMPT,
      user: planPrompt.buildUserMessage(input),
      maxTokens: maxTokensFor("plan"),
      mockResponse: () => mockPlan(input),
    },
    onAttempt: ledgerFor(ctx.workspaceId, "plan", MODELS.plan),
  });

  const validDates = new Set(input.weekDates);
  await withRepos(asSystem(), (r) =>
    r.plans.upsertWeek({
      creatorId,
      weekStart,
      summary: result.data.summary,
      model: result.model,
      promptVersion: planPrompt.PROMPT_VERSION,
      target: IDEAS_PER_WEEK,
      ideas: result.data.ideas.map((i) => ({
        title: i.title,
        format: i.format,
        hook: i.hook,
        reason: i.reason,
        dataRef: i.data_ref,
        // A date outside the week is a model slip; pin it to the week rather than drop the idea.
        suggestedDate: validDates.has(i.suggested_date) ? i.suggested_date : weekStart,
      })),
    }),
  );
}

/** Called by each run: only creates the week's plan if it does not exist yet (cost control). */
export async function ensureWeekPlan(ctx: AiContext, creatorId: string, now: Date): Promise<"created" | "exists"> {
  const exists = await withRepos(asSystem(), (r) => r.plans.getForWeek(creatorId, weekStartLondon(now)));
  if (exists) return "exists";
  await generateWeekPlan(ctx, creatorId, now);
  return "created";
}

export async function getCurrentPlan(userId: string, creatorId: string, now = new Date()): Promise<Plan | null> {
  return withRepos(asUser(userId), async (r) => {
    const creator = await r.creators.get(creatorId);
    if (!creator) throw notFound("Creator");
    return r.plans.getForWeek(creatorId, weekStartLondon(now));
  });
}

export async function setSuggestionStatus(
  userId: string,
  suggestionId: string,
  status: Exclude<SuggestionStatus, "proposed"> | "proposed",
  now = new Date(),
): Promise<Suggestion> {
  const updated = await withRepos(asUser(userId), (r) =>
    r.plans.setSuggestionStatus(suggestionId, status, userId, now),
  );
  // RLS hides other workspaces' suggestions, so "not yours" and "missing" look the same.
  if (!updated) throw notFound("Suggestion");
  return updated;
}

/** On-demand regenerate from the dashboard. Owners and admins only; respects the budget. */
export async function regeneratePlan(userId: string, creatorId: string, now = new Date()): Promise<void> {
  const access = await withRepos(asUser(userId), async (r) => {
    const creator = await r.creators.get(creatorId);
    if (!creator) throw notFound("Creator");
    const memberships = await r.workspaces.membershipsForUser(userId);
    const role = memberships.find((m) => m.workspaceId === creator.workspaceId)?.role;
    const settings = await r.workspaces.getSettings(creator.workspaceId);
    return { creator, role, settings };
  });
  if (access.role !== "owner" && access.role !== "admin") {
    throw forbidden("Only owners and admins can regenerate the plan.");
  }
  if (!access.settings) throw new AppError("INTERNAL", "Workspace settings are missing.");

  const budget = await budgetStatus(access.creator.workspaceId, access.settings.aiMonthlyBudgetUsd, now);
  if (budget.exhausted) {
    throw new AppError("RATE_LIMITED", "AI summaries are paused because the monthly budget has been reached.");
  }
  await generateWeekPlan({ workspaceId: access.creator.workspaceId }, creatorId, now);
}
