import { MODELS } from "@/lib/ai/client";
import { getAiProvider } from "@/lib/ai/factory";
import { planOutputSchema, planReplacementSchema, type PlanReplacementOutput } from "@/lib/ai/schemas";
import { generateStructured } from "@/lib/ai/structured";
import { budgetStatus } from "@/lib/ai/usage";
import { AppError, forbidden, notFound } from "@/lib/errors";
import {
  asSystem,
  asUser,
  withRepos,
  type Plan,
  type PostView,
  type Suggestion,
  type SuggestionStatus,
  type UsedSuggestion,
} from "@/lib/repositories";
import * as planPrompt from "@/prompts/plan/system";
import { mockPlan, mockReplacement } from "./mockAi";
import { buildPlanProfile, type PlanProfile } from "./planProfile";
import { isRepeat, trackUsedIdeas, type IdeaOutcome, type PlanTracking } from "./planTracking";
import {
  REPORT_PERIOD_DAYS,
  ledgerFor,
  maxTokensFor,
  promptHistory,
  toPromptPost,
  topAndBottom,
  type AiContext,
} from "./reportService";
import { londonIsoDate, weekDates, weekStartLondon } from "./time";

export const IDEAS_PER_WEEK = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How many used ideas the plan remembers and the tracker shows. */
const USED_MEMORY = 200;
/** Posts read to match used ideas to what was published. */
const TRACKING_POSTS = 300;

/** What the model is told about a used idea's post, at 2 dp like the UI. */
function resultText(outcome: IdeaOutcome): string {
  switch (outcome.state) {
    case "scored":
      return `score ${outcome.post.score.toFixed(2)}${outcome.post.label ? ` (${outcome.post.label})` : ""}`;
    case "scoring":
      return "posted, not scored yet";
    case "waiting":
      return "not posted yet";
    case "not_posted":
      return "never posted";
  }
}

async function loadPlanInput(creatorId: string, now: Date): Promise<planPrompt.PlanInput> {
  const weekStart = weekStartLondon(now);
  const since = new Date(now.getTime() - REPORT_PERIOD_DAYS * DAY_MS);
  const data = await withRepos(asSystem(), async (r) => {
    const creator = await r.creators.get(creatorId);
    if (!creator) throw notFound("Creator");
    const posts = await r.posts.listViews(creatorId, {}, TRACKING_POSTS, null);
    const insight = await r.insights.latestCommentInsight(creatorId);
    const decided = await r.plans.recentDecided(creatorId, 20);
    const used = await r.plans.usedForCreator(creatorId, USED_MEMORY);
    return { creator, posts, insight, decided, used };
  });

  const tracking = trackUsedIdeas(data.used, data.posts, now);
  const { top, bottom } = topAndBottom(data.posts, since);
  return {
    username: data.creator.username,
    weekStart,
    weekDates: weekDates(weekStart),
    top: top.map(toPromptPost),
    bottom: bottom.map(toPromptPost),
    history: promptHistory(data.posts, since).history,
    themes: (data.insight?.themes ?? []).map(({ label, count, sentiment }) => ({ label, count, sentiment })),
    decided: data.decided,
    used: tracking.ideas.map((i) => ({ title: i.title, format: i.format, result: resultText(i.outcome) })),
    profile: buildPlanProfile(data.posts, tracking.ideas),
  };
}

/** Generates (or refreshes in place) the week's plan for one creator. System scope. */
export async function generateWeekPlan(ctx: AiContext, creatorId: string, now: Date): Promise<void> {
  const input = await loadPlanInput(creatorId, now);
  const weekStart = input.weekStart;

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
  const usedTitles = input.used.map((u) => u.title);
  // The prompt forbids repeats; this enforces it, leaving that day visibly empty instead.
  const fresh = result.data.ideas.filter((i) => !isRepeat(i.title, usedTitles));
  await withRepos(asSystem(), (r) =>
    r.plans.upsertWeek({
      creatorId,
      weekStart,
      summary: result.data.summary,
      model: result.model,
      promptVersion: planPrompt.PROMPT_VERSION,
      target: IDEAS_PER_WEEK,
      ideas: fresh.map((i) => ({
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

export interface Replacement {
  replacement: Suggestion | null;
  /** Why no new idea was written, when that is worth telling the user. */
  note: ReplacementNote | null;
}

export type ReplacementNote = "day_passed" | "budget" | "ai_failed" | "rate_limited";

/**
 * After an idea is marked used it leaves its day for the tracker; this writes one new idea for
 * that day (D-047). Any member may do it, as anyone may mark an idea used. It never adds a
 * second idea to a day that already has one, so undo-then-redo cannot stack replacements.
 */
export async function replaceUsedSuggestion(
  userId: string,
  suggestionId: string,
  now = new Date(),
): Promise<Replacement> {
  const { s, creator, plan, settings } = await withRepos(asUser(userId), async (r) => {
    const s = await r.plans.getSuggestion(suggestionId);
    if (!s) throw notFound("Suggestion");
    const creator = await r.creators.get(s.creatorId);
    if (!creator) throw notFound("Creator");
    const plan = await r.plans.getForWeek(s.creatorId, s.weekStart);
    const settings = await r.workspaces.getSettings(creator.workspaceId);
    return { s, creator, plan, settings };
  });
  if (s.status !== "used" || !plan) return { replacement: null, note: null };

  const day = s.suggestedDate;
  if (s.weekStart !== weekStartLondon(now) || !day || day < londonIsoDate(now)) {
    return { replacement: null, note: "day_passed" };
  }
  const occupied = plan.suggestions.some((x) => x.id !== s.id && x.suggestedDate === day && x.status !== "used");
  if (occupied) return { replacement: null, note: null };

  if (!settings) throw new AppError("INTERNAL", "Workspace settings are missing.");
  const budget = await budgetStatus(creator.workspaceId, settings.aiMonthlyBudgetUsd, now);
  if (budget.exhausted) {
    return { replacement: null, note: "budget" };
  }

  const input = await loadPlanInput(s.creatorId, now);
  const others = plan.suggestions
    .filter((x) => x.id !== s.id && x.status !== "used")
    .map((x) => ({ title: x.title, format: x.format, date: x.suggestedDate }));
  const replacementInput: planPrompt.ReplacementInput = {
    ...input,
    date: day,
    replacing: { title: s.title, format: s.format },
    others,
  };
  const taken = [...input.used.map((u) => u.title), ...others.map((o) => o.title), s.title];
  // A repeat fails validation, so generateStructured sends it back once with the reason.
  const schema = planReplacementSchema.refine((o) => !isRepeat(o.idea.title, taken), {
    message: "this title repeats an idea already used or planned; propose a genuinely new idea",
    path: ["idea", "title"],
  });

  let idea: PlanReplacementOutput["idea"];
  try {
    const result = await generateStructured(schema, {
      provider: getAiProvider(),
      request: {
        purpose: "plan",
        model: MODELS.plan,
        system: planPrompt.REPLACE_SYSTEM_PROMPT,
        user: planPrompt.buildReplacementMessage(replacementInput),
        maxTokens: maxTokensFor("plan"),
        mockResponse: () => mockReplacement(replacementInput),
      },
      onAttempt: ledgerFor(creator.workspaceId, "plan", MODELS.plan),
    });
    idea = result.data.idea;
  } catch {
    // The used mark is already saved; the day stays empty and the user is told why.
    return { replacement: null, note: "ai_failed" };
  }

  const replacement = await withRepos(asSystem(), (r) =>
    r.plans.insertSuggestion(s.planId, {
      title: idea.title,
      format: idea.format,
      hook: idea.hook,
      reason: idea.reason,
      dataRef: idea.data_ref,
      // The free day is fixed; the model only chooses the idea.
      suggestedDate: day,
    }),
  );
  return { replacement, note: null };
}

/**
 * Whether the plan is working: every used idea matched to its post and score (D-047), and
 * the performance profile the plan is built from (D-049).
 */
export async function getPlanProgress(
  userId: string,
  creatorId: string,
  now = new Date(),
): Promise<{ tracking: PlanTracking; profile: PlanProfile }> {
  const { used, posts } = await withRepos(asUser(userId), async (r) => {
    const creator = await r.creators.get(creatorId);
    if (!creator) throw notFound("Creator");
    const used: UsedSuggestion[] = await r.plans.usedForCreator(creatorId, USED_MEMORY);
    const posts: PostView[] = await r.posts.listViews(creatorId, {}, TRACKING_POSTS, null);
    return { used, posts };
  });
  const tracking = trackUsedIdeas(used, posts, now);
  return { tracking, profile: buildPlanProfile(posts, tracking.ideas) };
}
