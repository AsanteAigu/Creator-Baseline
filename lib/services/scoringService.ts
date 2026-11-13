import { z } from "zod";
import type { Repos, ScoringSettingsRow, ScoreWrite } from "@/lib/repositories";
import {
  computeBaseline,
  roundForStorage,
  scoreAll,
  weightsFor,
  type PostFormat,
  type ScoreResult,
  type ScoringConfig,
  type Weights,
} from "@/lib/scoring";

const FORMATS: readonly PostFormat[] = ["reel", "image", "carousel"];

const weightsSchema = z
  .object({
    watch_time: z.number().min(0).max(1).optional(),
    sends: z.number().min(0).max(1).optional(),
    saves: z.number().min(0).max(1).optional(),
    likes: z.number().min(0).max(1).optional(),
    comments: z.number().min(0).max(1).optional(),
  })
  .strict();

/** Settings rows are jsonb: validate before they reach the pure scoring code. */
export function settingsToConfig(s: ScoringSettingsRow): ScoringConfig {
  return {
    weights: weightsSchema.parse(s.weights) as Weights,
    photoWeights: weightsSchema.parse(s.photoWeights) as Weights,
    cap: s.cap,
    strongCutoff: s.strongCutoff,
    weakCutoff: s.weakCutoff,
    minAgeHours: s.minAgeHours,
    medianWindow: s.medianWindow,
  };
}

function round4(values: Partial<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined) out[k] = roundForStorage(v);
  return out;
}

function toWrite(result: ScoreResult, format: PostFormat, config: ScoringConfig): ScoreWrite {
  return {
    postId: result.postId,
    score: result.score === null ? null : roundForStorage(result.score),
    label: result.label,
    rValues: round4(result.rValues),
    weightsSnapshot: {
      base: weightsFor(format, config),
      applied: round4(result.weightsUsed),
      cap: config.cap,
      strongCutoff: config.strongCutoff,
      weakCutoff: config.weakCutoff,
    },
    signalsUsed: result.signalsUsed,
  };
}

/** Recomputes this run's baselines (per format) and scores every post. Deterministic. */
export async function scoreCreator(
  repos: Repos,
  creatorId: string,
  runId: string,
  config: ScoringConfig,
  now: Date,
): Promise<{ scored: number; results: ScoreResult[] }> {
  const posts = await repos.posts.listScorable(creatorId);

  for (const format of FORMATS) {
    const baseline = computeBaseline(posts, {
      format,
      now,
      minAgeHours: config.minAgeHours,
      medianWindow: config.medianWindow,
    });
    await repos.scores.upsertBaseline(creatorId, runId, baseline, now);
  }

  const results = scoreAll(posts, config, now);
  const formatById = new Map(posts.map((p) => [p.id, p.format]));
  await repos.scores.upsertScores(
    runId,
    now,
    results.map((r) => toWrite(r, formatById.get(r.postId) ?? "reel", config)),
  );

  return { scored: results.filter((r) => r.score !== null).length, results };
}
