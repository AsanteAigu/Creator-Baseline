import { budgetStatus } from "@/lib/ai/usage";
import { asSystem, withRepos } from "@/lib/repositories";
import { generateWeekPlan } from "./planService";
import { intervalHours } from "./time";

const HOUR_MS = 60 * 60 * 1000;

/** Pure so the interval rule is testable without a database. */
export function isDueForSync(lastSyncedAt: Date | null, scheduleInterval: string, now: Date): boolean {
  if (lastSyncedAt === null) return true;
  return lastSyncedAt.getTime() + intervalHours(scheduleInterval) * HOUR_MS <= now.getTime();
}

/**
 * Creators whose workspace interval has elapsed (§8). One row per creator, not a dynamic
 * cron per creator; the hourly tick fans out an event for each id (D-032).
 */
export async function dueCreatorIds(now: Date = new Date()): Promise<string[]> {
  const creators = await withRepos(asSystem(), (r) => r.creators.listSchedulable());
  return creators
    .filter((c) => c.status === "active" && isDueForSync(c.lastSyncedAt, c.scheduleInterval, now))
    .map((c) => c.id);
}

export type WeeklyPlanOutcome = "generated" | "budget" | "missing";

/**
 * One creator's Monday plan. The budget check lives here, not in the prompt call, so a
 * retried step and the dashboard's regenerate path apply the same rule (§7).
 */
export async function generateWeeklyPlanForCreator(
  creatorId: string,
  now: Date = new Date(),
): Promise<WeeklyPlanOutcome> {
  const access = await withRepos(asSystem(), async (r) => {
    const creator = await r.creators.get(creatorId);
    if (!creator) return null;
    const settings = await r.workspaces.getSettings(creator.workspaceId);
    return { creator, settings };
  });
  if (!access) return "missing";
  if (!access.settings) throw new Error(`workspace ${access.creator.workspaceId} has no scoring settings`);

  const budget = await budgetStatus(access.creator.workspaceId, access.settings.aiMonthlyBudgetUsd, now);
  if (budget.exhausted) return "budget";

  await generateWeekPlan({ workspaceId: access.creator.workspaceId }, creatorId, now);
  return "generated";
}

/** Creator ids for the Monday job; active accounts only, ordered for stable step ids. */
export async function weeklyPlanCreatorIds(): Promise<string[]> {
  const creators = await withRepos(asSystem(), (r) => r.creators.listSchedulable());
  return creators.filter((c) => c.status === "active").map((c) => c.id);
}
