import type { Tx } from "@/lib/db/client";

export type AiPurpose = "themes" | "report" | "plan";

export interface AiCallRecord {
  workspaceId: string;
  purpose: AiPurpose;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
}

export function aiCallsRepo(tx: Tx) {
  return {
    async record(c: AiCallRecord): Promise<void> {
      await tx`
        insert into public.ai_calls
          (workspace_id, purpose, model, input_tokens, output_tokens, cost_usd, latency_ms, ok)
        values (${c.workspaceId}, ${c.purpose}, ${c.model}, ${c.inputTokens}, ${c.outputTokens},
                ${c.costUsd}, ${c.latencyMs}, ${c.ok})
      `;
    },

    async spendSince(workspaceId: string, since: Date): Promise<number> {
      const [row] = await tx<{ total: number | null }[]>`
        select sum(cost_usd) as total from public.ai_calls
        where workspace_id = ${workspaceId} and created_at >= ${since}
      `;
      return row?.total ?? 0;
    },
  };
}
