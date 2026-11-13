import type { Tx } from "@/lib/db/client";
import type { Weights } from "@/lib/scoring";

export type Role = "owner" | "admin" | "viewer";

export interface Membership {
  workspaceId: string;
  workspaceName: string;
  role: Role;
}

export interface ScoringSettingsRow {
  workspaceId: string;
  weights: Weights;
  photoWeights: Weights;
  cap: number;
  strongCutoff: number;
  weakCutoff: number;
  minAgeHours: number;
  medianWindow: number;
  scheduleInterval: string;
  aiMonthlyBudgetUsd: number;
  updatedAt: Date;
}

export type ScoringSettingsPatch = Partial<Omit<ScoringSettingsRow, "workspaceId" | "updatedAt">>;

interface SettingsDbRow {
  workspace_id: string;
  weights: Weights;
  photo_weights: Weights;
  cap: number;
  strong_cutoff: number;
  weak_cutoff: number;
  min_age_hours: number;
  median_window: number;
  schedule_cron: string;
  ai_monthly_budget_usd: number;
  updated_at: Date;
}

function toSettings(r: SettingsDbRow): ScoringSettingsRow {
  return {
    workspaceId: r.workspace_id,
    weights: r.weights,
    photoWeights: r.photo_weights,
    cap: r.cap,
    strongCutoff: r.strong_cutoff,
    weakCutoff: r.weak_cutoff,
    minAgeHours: r.min_age_hours,
    medianWindow: r.median_window,
    scheduleInterval: r.schedule_cron,
    aiMonthlyBudgetUsd: r.ai_monthly_budget_usd,
    updatedAt: r.updated_at,
  };
}

export function workspacesRepo(tx: Tx) {
  return {
    async membershipsForUser(userId: string): Promise<Membership[]> {
      const rows = await tx<{ workspace_id: string; name: string; role: Role }[]>`
        select m.workspace_id, w.name, m.role
        from public.workspace_members m
        join public.workspaces w on w.id = m.workspace_id
        where m.user_id = ${userId}
        order by m.created_at
      `;
      return rows.map((r) => ({ workspaceId: r.workspace_id, workspaceName: r.name, role: r.role }));
    },

    async getSettings(workspaceId: string): Promise<ScoringSettingsRow | null> {
      const [row] = await tx<SettingsDbRow[]>`
        select workspace_id, weights, photo_weights, cap, strong_cutoff, weak_cutoff,
               min_age_hours, median_window, schedule_cron, ai_monthly_budget_usd, updated_at
        from public.scoring_settings where workspace_id = ${workspaceId}
      `;
      return row ? toSettings(row) : null;
    },

    /** Returns null when RLS hides the row or the caller's role may not update it. */
    async updateSettings(workspaceId: string, patch: ScoringSettingsPatch): Promise<ScoringSettingsRow | null> {
      const [row] = await tx<SettingsDbRow[]>`
        update public.scoring_settings set
          weights               = coalesce(${patch.weights ? tx.json(patch.weights) : null}::jsonb, weights),
          photo_weights         = coalesce(${patch.photoWeights ? tx.json(patch.photoWeights) : null}::jsonb, photo_weights),
          cap                   = coalesce(${patch.cap ?? null}::numeric, cap),
          strong_cutoff         = coalesce(${patch.strongCutoff ?? null}::numeric, strong_cutoff),
          weak_cutoff           = coalesce(${patch.weakCutoff ?? null}::numeric, weak_cutoff),
          min_age_hours         = coalesce(${patch.minAgeHours ?? null}::int, min_age_hours),
          median_window         = coalesce(${patch.medianWindow ?? null}::int, median_window),
          schedule_cron         = coalesce(${patch.scheduleInterval ?? null}::text, schedule_cron),
          ai_monthly_budget_usd = coalesce(${patch.aiMonthlyBudgetUsd ?? null}::numeric, ai_monthly_budget_usd)
        where workspace_id = ${workspaceId}
        returning workspace_id, weights, photo_weights, cap, strong_cutoff, weak_cutoff,
                  min_age_hours, median_window, schedule_cron, ai_monthly_budget_usd, updated_at
      `;
      return row ? toSettings(row) : null;
    },

    async recordAudit(entry: {
      workspaceId: string;
      actorUserId: string | null;
      action: string;
      subject: string | null;
      metadata?: Record<string, string | number | boolean | null>;
    }): Promise<void> {
      await tx`
        insert into public.audit_log (workspace_id, actor_user_id, action, subject, metadata)
        values (${entry.workspaceId}, ${entry.actorUserId}, ${entry.action}, ${entry.subject},
                ${tx.json(entry.metadata ?? {})})
      `;
    },

    /** System scope only: the audit trail must outlive the creator it describes. */
    async beginDeletionRequest(workspaceId: string, creatorId: string, now: Date): Promise<string> {
      const [row] = await tx<{ id: string }[]>`
        insert into public.deletion_requests (workspace_id, creator_id, requested_at)
        values (${workspaceId}, ${creatorId}, ${now})
        returning id
      `;
      if (!row) throw new Error("deletion request was not stored");
      return row.id;
    },

    async completeDeletionRequest(id: string, now: Date): Promise<void> {
      await tx`update public.deletion_requests set completed_at = ${now} where id = ${id}`;
    },

    /** Daily safety net: requests whose purge did not finish (D-033). */
    async pendingDeletionRequests(): Promise<{ id: string; workspaceId: string; creatorId: string }[]> {
      const rows = await tx<{ id: string; workspace_id: string; creator_id: string }[]>`
        select id, workspace_id, creator_id from public.deletion_requests
        where completed_at is null
        order by requested_at
      `;
      return rows.map((r) => ({ id: r.id, workspaceId: r.workspace_id, creatorId: r.creator_id }));
    },
  };
}
