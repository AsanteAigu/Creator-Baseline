import { inScope, type Scope, type Tx } from "@/lib/db/client";
import { aiCallsRepo } from "./aiCalls";
import { authRepo } from "./auth";
import { creatorsRepo } from "./creators";
import { healthRepo } from "./health";
import { insightsRepo } from "./insights";
import { plansRepo } from "./plans";
import { postsRepo } from "./posts";
import { runsRepo } from "./runs";
import { scoresRepo } from "./scores";
import { workspacesRepo } from "./workspaces";

function bind(tx: Tx) {
  return {
    aiCalls: aiCallsRepo(tx),
    auth: authRepo(tx),
    creators: creatorsRepo(tx),
    health: healthRepo(tx),
    insights: insightsRepo(tx),
    plans: plansRepo(tx),
    posts: postsRepo(tx),
    runs: runsRepo(tx),
    scores: scoresRepo(tx),
    workspaces: workspacesRepo(tx),
  };
}

export type Repos = ReturnType<typeof bind>;
export type { Scope };

/** User-facing requests: Postgres RLS decides what is visible. */
export const asUser = (userId: string): Scope => ({ kind: "user", userId });
/** Background jobs only (BUILD_PROMPT §4): never use in a user request path. */
export const asSystem = (): Scope => ({ kind: "system" });

/** Runs `fn` in one transaction with every repository bound to it. */
export function withRepos<T>(scope: Scope, fn: (repos: Repos) => Promise<T>): Promise<T> {
  return inScope(scope, (tx) => fn(bind(tx)));
}

export type { AiCallRecord, AiPurpose } from "./aiCalls";
export type { ConnectionWrite, Creator, CreatorStatus, SchedulableCreator, TokenMaterial } from "./creators";
export type { CommentInsight, Report, ReportPoint, ThemeAggregate } from "./insights";
export type { Plan, Suggestion, SuggestionStatus, SuggestionWrite } from "./plans";
export type { PostCursor, PostListFilter, PostView } from "./posts";
export type { Run, RunStatus, RunTrigger } from "./runs";
export type { BaselineView, ScoreWrite, TrendPoint, WeightsSnapshot } from "./scores";
export type { Membership, Role, ScoringSettingsPatch, ScoringSettingsRow } from "./workspaces";
