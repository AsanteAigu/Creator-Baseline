import { asSystem, withRepos, type AiPurpose } from "@/lib/repositories";
import type { AiResponse } from "./provider";

/**
 * USD per million tokens (Anthropic first-party pricing, checked 2026-11-13). Gemini is used
 * on Google's free tier, so its calls cost 0 and are absent here (D-039).
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
};
/** Cache writes are billed at 1.25x the input rate (5-minute TTL). */
const CACHE_WRITE_MULTIPLIER = 1.25;

export function costUsd(model: string, usage: Omit<AiResponse, "text" | "model">): number {
  const price = PRICES[model];
  if (!price) return 0;
  const perToken = (perMillion: number) => perMillion / 1_000_000;
  return (
    usage.inputTokens * perToken(price.input) +
    usage.outputTokens * perToken(price.output) +
    usage.cacheReadTokens * perToken(price.cacheRead) +
    usage.cacheWriteTokens * perToken(price.input * CACHE_WRITE_MULTIPLIER)
  );
}

export interface LedgerEntry {
  workspaceId: string;
  purpose: AiPurpose;
  model: string;
  response: AiResponse | null;
  latencyMs: number;
  ok: boolean;
}

/** Every call is logged, successful or not. Never logs prompt bodies (they contain comments). */
export async function recordAiCall(entry: LedgerEntry): Promise<void> {
  const usage = entry.response ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  await withRepos(asSystem(), (r) =>
    r.aiCalls.record({
      workspaceId: entry.workspaceId,
      purpose: entry.purpose,
      model: entry.response?.model ?? entry.model,
      inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      // Price by the model that answered: the Gemini provider ignores the requested Claude id.
      costUsd: Math.round(costUsd(entry.response?.model ?? entry.model, usage) * 1_000_000) / 1_000_000,
      latencyMs: entry.latencyMs,
      ok: entry.ok,
    }),
  );
}

export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface BudgetStatus {
  spentUsd: number;
  budgetUsd: number;
  exhausted: boolean;
}

export async function budgetStatus(workspaceId: string, budgetUsd: number, now: Date): Promise<BudgetStatus> {
  const spentUsd = await withRepos(asSystem(), (r) => r.aiCalls.spendSince(workspaceId, monthStartUtc(now)));
  return { spentUsd, budgetUsd, exhausted: spentUsd >= budgetUsd };
}
