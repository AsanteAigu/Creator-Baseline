# Architecture

Status: Phases 0-5 built (schema, scoring, mock + Graph ingestion, AI layer, dashboard,
OAuth). Sections marked *planned* describe Phase 6 work.

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
| `lib/ai/` | Anthropic SDK (only `client.ts`), Zod schemas, cost ledger | be called per post or per comment |
| `lib/instagram/` | Graph API transport, metric mapping | leak tokens into logs or responses |
| `components/` | rendering | import repositories, decide labels |

Import direction: `app → services → repositories → db`. These rules are enforced by
`no-restricted-imports` in `eslint.config.mjs`, so a violation fails `pnpm lint`.

## Data model

Defined in `supabase/migrations/20261113000100_initial_schema.sql`. Summary:

```
workspaces ─┬─ workspace_members (user ↔ workspace, role owner|admin|viewer)
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

## Environment

`lib/config.ts` parses env with Zod, lazily (so `next build` needs no secrets) and reports
variable *names* only on failure. Cross-field rules: `AI_PROVIDER=anthropic` requires
`ANTHROPIC_API_KEY`; `INSTAGRAM_SOURCE=graph` requires the Instagram app credentials and a
32-byte `TOKEN_ENCRYPTION_KEY`; production requires Supabase, Upstash and Inngest keys.

## Local development without Docker

Supabase's CLI needs Docker. `pnpm db:migrate` instead applies the migrations to any Postgres
in `DATABASE_URL`. If `auth.users` is absent it first applies
`supabase/local/auth-shim.sql`, which creates the `auth` schema, `auth.uid()` (reading the
same JWT claim settings Supabase uses) and the `anon` / `authenticated` / `service_role`
roles. The same migration files are what `supabase db push` applies to a real project.

## Pipeline (built; scheduling via Inngest is *planned* for Phase 6)

`scheduleTick` (hourly) → `ingestCreator` per due creator: upsert posts → fetch insights →
append metrics → recompute baselines → score → themes → report → update plan in place.
AI failure never fails a run; deterministic results are stored and the AI sections stay null.

Today the pipeline runs from `pnpm ingest` or the dashboard's "Update now" (inline, see
DECISIONS D-022). Code path: `lib/services/runService.ts` -> `scoringService` (pure
`lib/scoring`) -> `reportService` (themes + report) -> `planService` (weekly plan).

## Instagram adapter

`lib/instagram/` puts the API behind `InstagramSource`. `INSTAGRAM_SOURCE=mock` serves
deterministic fixtures; `graph` uses `GraphInstagramSource` against Graph API v27.0. The
Graph client keeps one request in flight, times each out, retries 429/5xx with exponential
backoff and paces itself from Meta's usage headers. Tokens travel in the `Authorization`
header; no URL, header or response body is logged.

Logins: `/api/creators/connect` sets a signed, HTTP-only state cookie and redirects to
Facebook Login for Business; `/api/creators/callback` checks the nonce, exchanges the code
server-side for a long-lived user token, finds the Instagram professional account behind the
Facebook Page and stores the token AES-256-GCM encrypted (`access_token_ciphertext`,
`token_iv`, `token_expires_at`). Reconnects carry the creator id in the signed state and
must match the same Instagram account (D-029). Tokens are refreshed inside the last seven
days of their ~60-day life at the start of a run (D-027). An auth failure sets
`creators.status = needs_reauth`; the dashboard shows a banner with a Reconnect action.

The watch-time signal, insight availability and the interface shape differ from §5/§6 in
three deliberate ways; see D-024 to D-026.

## Auth and data access

`lib/auth/session.ts` resolves the signed-in user (Supabase Auth, or the local signed cookie
in development). Services then open a *user scope* transaction (`SET LOCAL ROLE
authenticated` + JWT claims) so Postgres RLS decides what the user can see or change.
Background work uses *system scope*. See DECISIONS D-015 and D-020.
