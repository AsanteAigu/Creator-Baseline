# Architecture

How Creator Baseline v1 is put together: layers, data model, security model, pipeline, jobs
and integrations. The build specification is [`SPECIFICATION.md`](SPECIFICATION.md); every
judgement call is in [`DECISIONS.md`](DECISIONS.md).

## Overview

```
                      ┌──────────────────────────────┐
  Browser (dashboard) │ Next.js App Router (Vercel)  │
  ───────────────────▶│  app/ pages + app/api routes │
                      └──────────────┬───────────────┘
                                     │ calls
                      ┌──────────────▼───────────────┐
                      │ lib/services                 │◀── jobs/ (Inngest)
                      │  run, scoring, report, plan, │      scheduleTick, ingestCreator,
                      │  creator                     │      weeklyPlan, purgeExpired
                      └───┬──────────┬──────────┬────┘
                          │          │          │
            ┌─────────────▼──┐ ┌─────▼──────┐ ┌─▼──────────────────┐
            │ lib/repositories│ │ lib/scoring│ │ lib/ai  lib/instagram│
            │ (all SQL)       │ │ (pure)     │ │ (external I/O behind │
            └───────┬─────────┘ └────────────┘ │  an interface + mock)│
                    │                          └──────────────────────┘
            ┌───────▼─────────┐
            │ Supabase Postgres│  RLS on every table, tenancy = workspace
            └──────────────────┘
```

## Layers

| Layer | Knows about | Must not |
|---|---|---|
| `app/api/**` route handlers, server actions | HTTP, Zod input validation, session | query the DB, compute scores |
| `lib/services/` | business rules, orchestration | import `postgres`, `@supabase/*`, `next/*` |
| `lib/repositories/` | SQL, row ↔ domain mapping | contain business rules |
| `lib/scoring/` | numbers | import anything except relative types |
| `lib/ai/` | provider clients (Gemini, Anthropic SDK only in `client.ts`, mock), Zod schemas, cost ledger | be called per post or per comment |
| `lib/instagram/` | Graph API transport, metric mapping | leak tokens into logs or responses |
| `components/` | rendering | import repositories, decide labels |

Import direction: `app → services → repositories → db`. These rules are enforced by
`no-restricted-imports` in `eslint.config.mjs`, so a violation fails `pnpm lint`.

## Data model

Defined in `supabase/migrations/` (initial schema, then the audit policy and the creator role
with invites). Summary:

```
workspaces ─┬─ workspace_members (user ↔ workspace, role owner|admin|viewer|creator)
            ├─ workspace_invites (single-use invite links)
            ├─ scoring_settings (1:1; weights, cutoffs, cap, window, schedule, AI budget)
            ├─ ai_calls, audit_log, deletion_requests
            └─ creators ─┬─ runs ─┬─ post_metrics (append-only snapshot per post per run)
                         │        ├─ baselines   (per format per run)
                         │        ├─ post_scores (per post per run, weights_snapshot)
                         │        └─ comment_insights (aggregates only, 1 per run)
                         ├─ posts
                         ├─ reports
                         └─ content_plans ── plan_suggestions
```

Deleting a creator cascades to every row that references it. `deletion_requests.creator_id`
is deliberately not a foreign key so the record of a purge survives the purge.

### Idempotency keys

| Table | Unique key | Why |
|---|---|---|
| `runs` | `(creator_id, window_start)` | one pipeline run per creator per window |
| `post_metrics` | `(post_id, run_id)` | re-running a window doesn't add snapshots |
| `post_scores` | `(post_id, run_id)` | same |
| `baselines` | `(run_id, format)` | same |
| `comment_insights` | `run_id` | one themes call per run |
| `reports` | `(creator_id, period_start, period_end)` | one report per period |
| `content_plans` | `(creator_id, week_start)` | plan is updated in place |

## Security model

- **RLS everywhere.** Each table enables RLS in the migration that creates it. Policies call
  three `SECURITY DEFINER` helpers with a pinned `search_path`:
  `is_workspace_member(ws)`, `has_workspace_role(ws, roles)`, `can_access_creator(creator_id)`.
- **Grants narrow further.** `anon` has nothing. `authenticated` gets `SELECT` everywhere RLS
  allows, plus column-scoped `UPDATE` on `plan_suggestions` (status) and `scoring_settings`
  (owner/admin by policy). Token columns on `creators` are not selectable by `authenticated`.
- **Service role** (`SUPABASE_SERVICE_ROLE_KEY`) bypasses RLS and is used only by background
  jobs, never in a user request.
- **Comments** are processed in memory and reduced to counts and paraphrased themes. No table
  has a column that could hold comment text or a username.
- **Deletion** is a single tested code path. `deletion_requests` and `audit_log` rows outlive
  the creator because `deletion_requests.creator_id` is text, not a foreign key.
- **No secrets in the browser.** `pnpm check:secrets` scans `.next/static` after a build for
  the names of server-only variables and for their values when present.

## Environment

`lib/config.ts` parses env with Zod, lazily (so `next build` needs no secrets) and reports
variable *names* only on failure. Cross-field rules: `AI_PROVIDER=gemini` requires
`GEMINI_API_KEY` and `AI_PROVIDER=anthropic` requires `ANTHROPIC_API_KEY`; `INSTAGRAM_SOURCE=graph` requires the Instagram app credentials and a
32-byte `TOKEN_ENCRYPTION_KEY`; production requires Supabase, Upstash and Inngest keys.

## Local development without Docker

Supabase's CLI needs Docker. `pnpm db:migrate` instead applies the migrations to any Postgres
in `DATABASE_URL`. If `auth.users` is absent it first applies
`supabase/local/auth-shim.sql`, which creates the `auth` schema, `auth.uid()` (reading the
same JWT claim settings Supabase uses) and the `anon` / `authenticated` / `service_role`
roles. The same migration files are what `supabase db push` applies to a real project.

## Pipeline

`scheduleTick` (hourly) → `ingestCreator` per due creator: upsert posts → fetch insights →
append metrics → recompute baselines → score → themes → report → update plan in place.
AI failure never fails a run; deterministic results are stored and the AI sections stay null.

Code path: `lib/services/runService.ts` -> `scoringService` (pure `lib/scoring`) ->
`reportService` (themes + report) -> `planService` (weekly plan). The same function serves
the scheduler, `pnpm ingest` and the dashboard's "Update now".

## Jobs

One Inngest app registered at `/api/inngest` (`jobs/index.ts` is the single list `serve()`
receives):

| Function | Trigger | Work |
|---|---|---|
| `schedule-tick` | hourly cron | `dueCreatorIds()` then one `creator/sync.requested` event per creator |
| `ingest-creator` | typed event | `ingestCreator(..., { trigger: "schedule" })` in one retryable step |
| `weekly-plan` | Monday 06:00 Europe/London | one step per active creator, budget-guarded |
| `purge-expired` | daily 03:30 Europe/London | `failOrphans` + finish pending deletion requests |

The hourly tick is the only ingestion schedule; there is deliberately no dynamic cron per
creator (D-032). `ingestCreator` records Instagram and AI failures on the run row and returns
normally, so Inngest retries only unexpected throws. `runs.claim` makes a repeated event for
the same creator-window a no-op (`skipped: already_running`), and `failOrphans` clears runs
whose invocation died.

## Health

`GET /api/health` (authenticated, workspace-scoped, D-034) returns the deploy commit, the
migration ledger (or `null` when the host does not expose `app_meta`), and the latest run per
creator. `status: "degraded"` means a creator needs reauth or its latest run failed; the
response is still HTTP 200 so a monitor can distinguish it from an auth error.

## Disconnect and deletion

One path, `deleteCreator` in `lib/services/deletionService.ts`, used by the account page and
`DELETE /api/creators/:id` (D-033). It checks membership and the owner/admin role, inserts a
`deletion_requests` row, deletes the creator row (every child table cascades), marks the
request complete, writes `audit_log`, and only then revokes the app's permissions at Meta.
The local purge is authoritative; revocation is best effort and its failure is logged by
class only. `purgeExpired` retries requests that did not complete. It is housekeeping, not a
retention policy: past reports are kept (R7, D-035).

## Instagram adapter

`lib/instagram/` puts the API behind `InstagramSource`. `INSTAGRAM_SOURCE=mock` serves
deterministic fixtures; `graph` uses `GraphInstagramSource` against Graph API v27.0. The
Graph client keeps one request in flight, times each out, retries 429/5xx with exponential
backoff and paces itself from Meta's usage headers. Tokens travel in the `Authorization`
header; no URL, header or response body is logged.

Logins: `/api/creators/connect` sets a signed, HTTP-only state cookie and redirects to Meta.
`INSTAGRAM_LOGIN_TYPE` picks the flow: `unified` (the default, and the only one Meta offers
apps created from late 2026; D-038), `instagram` (Instagram Login, older apps) or `facebook`
(Facebook Login for Business through a Page). `/api/creators/callback` checks the nonce and
exchanges the code server-side. With Unified Login the result is a business-portfolio token;
`/me/assigned_instagram_accounts` lists every account the login shared, and each new one is
stored as its own creator with the token encrypted separately (D-044). Tokens are stored
AES-256-GCM encrypted (`access_token_ciphertext`, `token_iv`, `token_expires_at`).

Reconnects carry the creator id in the signed state and must match the same Instagram account
(D-029). Expiring tokens are refreshed inside the last seven days of their life at the start
of a run (D-027); Unified Login tokens do not expire. An auth failure sets
`creators.status = needs_reauth`; the account page shows a banner with a Reconnect action.

The watch-time signal, insight availability and the interface shape differ from §5/§6 in
three deliberate ways; see D-024 to D-026.

## Auth and data access

`lib/auth/session.ts` resolves the signed-in user (Supabase Auth, or the local signed cookie
in development). Services then open a *user scope* transaction (`SET LOCAL ROLE
authenticated` + JWT claims) so Postgres RLS decides what the user can see or change.
Background work uses *system scope*. See DECISIONS D-015 and D-020.

Roles: `owner` and `admin` manage accounts, settings and members; `viewer` reads everything
in the workspace; `creator` joins through an invite link, connects their own Instagram once
and can only ever see that account (D-040, enforced by `can_access_creator`).

## AI layer

`lib/ai/provider.ts` defines one interface; `factory.ts` picks Gemini, Anthropic or the mock
from `AI_PROVIDER`. Every call goes through `generateStructured()` (`structured.ts`), which
validates the reply against a Zod schema, retries invalid output once, and records tokens and
cost in `ai_calls`. A monthly per-workspace budget pauses AI work when reached. Prompts live
in `prompts/` with a version string each and are snapshot-tested; the report and plan prompts
receive every post in the period with raw counts and must cite real posts and numbers (D-045).
