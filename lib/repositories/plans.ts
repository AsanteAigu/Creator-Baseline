import type { Tx } from "@/lib/db/client";
import type { PostFormat } from "@/lib/scoring";

export type SuggestionStatus = "proposed" | "used" | "not_used";

export interface Suggestion {
  id: string;
  planId: string;
  title: string;
  format: PostFormat;
  hook: string | null;
  reason: string | null;
  dataRef: string | null;
  suggestedDate: string | null;
  status: SuggestionStatus;
  decidedAt: Date | null;
}

export interface Plan {
  id: string;
  creatorId: string;
  weekStart: string;
  summary: string | null;
  model: string | null;
  promptVersion: string | null;
  updatedAt: Date;
  suggestions: Suggestion[];
}

export interface SuggestionWrite {
  title: string;
  format: PostFormat;
  hook: string;
  reason: string;
  dataRef: string;
  suggestedDate: string;
}

interface SuggestionDbRow {
  id: string;
  plan_id: string;
  title: string;
  format: PostFormat;
  hook: string | null;
  reason: string | null;
  data_ref: string | null;
  suggested_date: string | null;
  status: SuggestionStatus;
  decided_at: Date | null;
}

function toSuggestion(r: SuggestionDbRow): Suggestion {
  return {
    id: r.id,
    planId: r.plan_id,
    title: r.title,
    format: r.format,
    hook: r.hook,
    reason: r.reason,
    dataRef: r.data_ref,
    suggestedDate: r.suggested_date,
    status: r.status,
    decidedAt: r.decided_at,
  };
}

export function plansRepo(tx: Tx) {
  return {
    /** weekStart is an ISO date (YYYY-MM-DD), the Monday of the week in Europe/London. */
    async getForWeek(creatorId: string, weekStart: string): Promise<Plan | null> {
      const [plan] = await tx<
        {
          id: string;
          creator_id: string;
          week_start: string;
          summary: string | null;
          model: string | null;
          prompt_version: string | null;
          updated_at: Date;
        }[]
      >`
        select id, creator_id, to_char(week_start, 'YYYY-MM-DD') as week_start, summary, model,
               prompt_version, updated_at
        from public.content_plans where creator_id = ${creatorId} and week_start = ${weekStart}::date
      `;
      if (!plan) return null;
      const suggestions = await tx<SuggestionDbRow[]>`
        select id, plan_id, title, format, hook, reason, data_ref,
               to_char(suggested_date, 'YYYY-MM-DD') as suggested_date, status, decided_at
        from public.plan_suggestions where plan_id = ${plan.id}
        order by suggested_date nulls last, title
      `;
      return {
        id: plan.id,
        creatorId: plan.creator_id,
        weekStart: plan.week_start,
        summary: plan.summary,
        model: plan.model,
        promptVersion: plan.prompt_version,
        updatedAt: plan.updated_at,
        suggestions: suggestions.map(toSuggestion),
      };
    },

    /**
     * Updates the week's plan in place (§7/§8): the plan row is upserted, suggestions the
     * client has already decided on are kept, and only undecided ones are replaced — so the
     * week never grows past `target` ideas and a re-run never duplicates them.
     */
    async upsertWeek(input: {
      creatorId: string;
      weekStart: string;
      summary: string;
      model: string;
      promptVersion: string;
      ideas: SuggestionWrite[];
      target: number;
    }): Promise<void> {
      const [plan] = await tx<{ id: string }[]>`
        insert into public.content_plans (creator_id, week_start, summary, model, prompt_version)
        values (${input.creatorId}, ${input.weekStart}::date, ${input.summary}, ${input.model}, ${input.promptVersion})
        on conflict (creator_id, week_start) do update set
          summary = excluded.summary, model = excluded.model, prompt_version = excluded.prompt_version
        returning id
      `;
      if (!plan) throw new Error("content plan upsert returned no row");

      await tx`delete from public.plan_suggestions where plan_id = ${plan.id} and status = 'proposed'`;
      const [{ decided } = { decided: 0 }] = await tx<{ decided: number }[]>`
        select count(*)::int as decided from public.plan_suggestions where plan_id = ${plan.id}
      `;
      const room = Math.max(0, input.target - decided);
      const rows = input.ideas.slice(0, room).map((i) => ({
        plan_id: plan.id,
        title: i.title,
        format: i.format,
        hook: i.hook,
        reason: i.reason,
        data_ref: i.dataRef,
        suggested_date: i.suggestedDate,
      }));
      if (rows.length > 0) await tx`insert into public.plan_suggestions ${tx(rows)}`;
    },

    async recentDecided(
      creatorId: string,
      limit: number,
    ): Promise<{ title: string; format: PostFormat; status: "used" | "not_used" }[]> {
      return tx<{ title: string; format: PostFormat; status: "used" | "not_used" }[]>`
        select s.title, s.format, s.status
        from public.plan_suggestions s
        join public.content_plans cp on cp.id = s.plan_id
        where cp.creator_id = ${creatorId} and s.status in ('used', 'not_used')
        order by s.decided_at desc nulls last
        limit ${limit}
      `;
    },

    /** Null when the suggestion does not exist or RLS hides it from the caller. */
    async setSuggestionStatus(
      id: string,
      status: SuggestionStatus,
      userId: string,
      now: Date,
    ): Promise<Suggestion | null> {
      const decidedAt = status === "proposed" ? null : now;
      const decidedBy = status === "proposed" ? null : userId;
      const [row] = await tx<SuggestionDbRow[]>`
        update public.plan_suggestions
        set status = ${status}, decided_at = ${decidedAt}, decided_by = ${decidedBy}
        where id = ${id}
        returning id, plan_id, title, format, hook, reason, data_ref,
                  to_char(suggested_date, 'YYYY-MM-DD') as suggested_date, status, decided_at
      `;
      return row ? toSuggestion(row) : null;
    },
  };
}
