import { z } from "zod";
import { AppError, forbidden } from "@/lib/errors";
import { asUser, withRepos, type ScoringSettingsRow } from "@/lib/repositories";
import { getWorkspaceContext } from "./creatorService";

export const SCHEDULE_INTERVALS = ["1 hour", "3 hours", "6 hours", "12 hours", "24 hours"] as const;

const weight = z.number().min(0).max(1);
const SUM_TOLERANCE = 0.001;

const sumsToOne = (w: Record<string, number>) =>
  Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) <= SUM_TOLERANCE;

/** Validated at the boundary; the DB constraints are the second line of defence. */
export const settingsPatchSchema = z
  .object({
    weights: z
      .object({ watch_time: weight, sends: weight, saves: weight, likes: weight, comments: weight })
      .strict()
      .refine(sumsToOne, "Reel weights must add up to 1.")
      .optional(),
    photoWeights: z
      .object({ sends: weight, saves: weight, likes: weight, comments: weight })
      .strict()
      .refine(sumsToOne, "Photo weights must add up to 1.")
      .optional(),
    cap: z.number().min(1).max(20).optional(),
    strongCutoff: z.number().min(0.1).max(10).optional(),
    weakCutoff: z.number().min(0.05).max(10).optional(),
    minAgeHours: z.number().int().min(0).max(168).optional(),
    medianWindow: z.number().int().min(5).max(100).optional(),
    scheduleInterval: z.enum(SCHEDULE_INTERVALS).optional(),
    aiMonthlyBudgetUsd: z.number().min(0).max(10_000).optional(),
  })
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export async function getSettings(userId: string): Promise<{ settings: ScoringSettingsRow; canEdit: boolean }> {
  const context = await getWorkspaceContext(userId);
  const settings = await withRepos(asUser(userId), (r) => r.workspaces.getSettings(context.workspaceId));
  if (!settings) throw new AppError("INTERNAL", "Scoring settings are missing for this workspace.");
  return { settings, canEdit: context.role === "owner" || context.role === "admin" };
}

/** New values apply from the next run; past scores keep their weights_snapshot. */
export async function updateSettings(userId: string, patch: SettingsPatch): Promise<ScoringSettingsRow> {
  const context = await getWorkspaceContext(userId);
  if (context.role !== "owner" && context.role !== "admin") {
    throw forbidden("Only owners and admins can change scoring settings.");
  }

  return withRepos(asUser(userId), async (r) => {
    const current = await r.workspaces.getSettings(context.workspaceId);
    if (!current) throw new AppError("INTERNAL", "Scoring settings are missing for this workspace.");
    const strong = patch.strongCutoff ?? current.strongCutoff;
    const weak = patch.weakCutoff ?? current.weakCutoff;
    if (weak >= strong) {
      throw new AppError("VALIDATION_FAILED", "The weak cutoff must be below the strong cutoff.", {
        weakCutoff: "Must be below the strong cutoff.",
      });
    }

    const updated = await r.workspaces.updateSettings(context.workspaceId, patch);
    // RLS returned nothing: the role changed between the check and the write.
    if (!updated) throw forbidden("Only owners and admins can change scoring settings.");

    await r.workspaces.recordAudit({
      workspaceId: context.workspaceId,
      actorUserId: userId,
      action: "settings.update",
      subject: "scoring_settings",
      metadata: { fields: Object.keys(patch).join(",") },
    });
    return updated;
  });
}
