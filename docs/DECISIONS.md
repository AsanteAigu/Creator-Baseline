# Decisions

Each entry: decision, alternatives considered, why. "Confirm" marks a v1 rule the client
should sign off.

## D-001 — Requirements document added as Markdown (Phase 0)

The client's `Social Media Growth Assistant Requirements Document.docx` was converted to
`docs/requirements.md` (stdlib-only converter; Word equations flatten, so a note at the top
restates them). The worked example in its §6 matches BUILD_PROMPT §5: 1.27, label Normal.

## D-002 — Local database without Docker

Decision: migrations are applied by `scripts/migrate.ts` to any Postgres in `DATABASE_URL`;
on plain Postgres a local-only shim (`supabase/local/auth-shim.sql`) supplies `auth.users`,
`auth.uid()` and the Supabase roles.
Alternatives: Supabase CLI local stack (needs Docker, not installed on the dev machine);
a hosted Supabase dev project (needs credentials, which Phase 0 shouldn't depend on).
Why: keeps "no external credentials" true, and RLS can still be exercised locally by
`set role authenticated` + `set request.jwt.claims`. The migration files are unchanged and
remain what `supabase db push` applies to a real project.

## D-003 — `ai_calls.workspace_id` added

Decision: added `workspace_id` (not in §4) to `ai_calls`.
Alternatives: a global budget; deriving workspace via a creator FK.
Why: the budget lives in `scoring_settings`, which is per workspace, so the running total
has to be per workspace too. It also gives the table an RLS anchor.

## D-004 — Idempotency columns added: `runs.window_start`, `run_id` on metrics/baselines

Decision: `runs` gets `window_start` with `unique (creator_id, window_start)`;
`post_metrics` and `baselines` get `run_id`; unique keys listed in ARCHITECTURE.md.
Alternatives: dedupe in application code only.
Why: §8 and acceptance criterion 3 require that re-running a window never duplicates rows.
A unique constraint makes that a database guarantee, not a hope.

## D-005 — Token columns nullable

Decision: `creators.access_token_ciphertext` / `token_iv` are nullable, with a check that
they are both null or both set.
Why: fixture creators in mock mode have no token. Not selectable by end users at all.

## D-006 — Who may toggle a plan suggestion (Confirm)

Decision: any workspace member, including `viewer`, may set a suggestion to used / not used.
Settings changes require `owner` or `admin`.
Alternatives: owner/admin only.
Why: marking what was posted is the client's everyday action; it changes no score.
Conservative fallback if the client disagrees: restrict the policy to owner/admin.

## D-007 — `schedule_cron` stores an interval from an allowlist (Confirm)

Decision: despite the column name from §4, it holds a minimum sync interval, one of
`1 hour | 3 hours | 6 hours | 12 hours | 24 hours` (default `6 hours`), enforced by CHECK.
Why: §8 says one hourly `scheduleTick` compares `last_synced_at` against it; per-creator
crons are banned. An allowlist keeps the settings UI a dropdown and avoids parsing free text.

## D-008 — Seed writes a bookkeeping run per creator

Decision: `post_metrics.run_id` is NOT NULL, so the seed inserts one succeeded `manual` run
per creator (posts_scored = 0) to own its snapshots.
Why: keeps the metrics table honest about which run captured each snapshot.

## D-009 — Demo users deferred to Phase 4

Decision: the seed creates the workspace, settings, creators, posts and metrics, but no
`auth.users` / `workspace_members`.
Why: real Supabase users must be created through the Auth admin API, which is Phase 4
(login). Inserting into `auth.users` directly would only work against the local shim.

## D-010 — TypeScript pinned to 6.0

Decision: `typescript@~6.0`, not 7.x.
Why: `typescript-eslint` (via `eslint-config-next`) supports `<6.1`. Revisit when it widens.

## D-011 — "The creator can see their own results" (requirements §4 vs BUILD_PROMPT) (Confirm)

Conflict: requirements §4 says each creator can see their own results; BUILD_PROMPT scopes
access per workspace (the agency), with no per-creator visibility.
Decision for now: workspace-level access only, as BUILD_PROMPT specifies. A creator invited
as a workspace `viewer` would see all three accounts.
Alternatives: a `creator_id` scope on `workspace_members` (or a `creator_access` table) and
policies that honour it — a data-model change, so it needs sign-off before Phase 1 closes.
Why: architecture follows BUILD_PROMPT; the behavioural gap is real and the client should choose.

## D-012 — Post formats: reel, image, carousel only (Confirm)

Requirements R3 says "Reels, photos and others". The schema allows `reel | image | carousel`.
Stories are excluded: their insights expire after 24 hours, which is the same age at which
a post first becomes scoreable, so they could never be scored. Other media types from the
API will be mapped to the nearest of the three (carousel of videos → carousel) in Phase 5.

## D-013 — Requirements §10 "younger than 1 day" = `min_age_hours` 24

Matches BUILD_PROMPT §5 edge case 1; stored as a setting, so it can change without a deploy.

## D-014 — `InstagramSource.listComments` added to the §6 interface

The themes call needs comments; the §6 interface had no way to fetch them. Added
`listComments(creator, mediaId, limit)`. Comments are returned as `{ text }` only and never
leave memory (see `runService.runAiSteps`).

## D-015 — How RLS is applied without PostgREST

Decision: repositories use one direct Postgres connection (`DATABASE_URL`). User requests
run inside a transaction that does `SET LOCAL ROLE authenticated` and sets
`request.jwt.claims` to the verified user id, so `auth.uid()` and every RLS policy apply
exactly as through Supabase's API. Jobs use "system scope" (the connection's own role).
Alternatives: supabase-js with the user's JWT for reads (two data paths, two query styles).
Why: one SQL layer, and RLS is still the gate on every user request — proven by the
integration tests. On Supabase use the transaction pooler URL (`prepare: false` is set).

## D-016 — Baseline columns hold rates

`baselines.median_likes/comments/shares/saves` store the median *rate per reach* (what
scoring compares against); `median_reach` stores the median reach count;
`median_watch_rate` the median watch fraction. §4 named the columns but not the unit.

## D-017 — Report period and plan cadence (Confirm)

- The "what worked / what didn't" report covers the last 28 days (enough posts at 1-3/day),
  regenerated each run, keyed by period so a re-run overwrites rather than duplicates.
- The weekly plan is written once per creator per London week during the first run of the
  week, plus on demand ("Refresh ideas", owner/admin, rate-limited, budget-checked).
  Writing it every 6-hour run would cost ~28 Sonnet calls a week per creator for little gain.
- Refreshing keeps suggestions the client already marked used / not used and replaces only
  undecided ones, so the week never exceeds 7 ideas ("updated in place").

## D-018 — AI degradation recorded on the run

A run whose AI step fails or is over budget still `succeeded`; `error_code` is set to
`AI_FAILED` or `AI_BUDGET` with a plain message. The dashboard reads this to show the
"summary couldn't be generated" / "AI summaries paused" banners. No schema change needed.

## D-019 — Other workspaces' resources return 404, not 403

RLS makes another workspace's rows invisible, so the API cannot tell "not yours" from
"doesn't exist" without a privileged lookup — and §11 forbids leaking other workspaces'
IDs. 403 is used for role failures inside your own workspace (e.g. a viewer changing settings).

## D-020 — Local sign-in when Supabase is not configured

With `NEXT_PUBLIC_SUPABASE_URL` empty, sign-in checks a bcrypt hash in the local auth shim
and issues an HMAC-signed, HTTP-only cookie (`SESSION_SECRET`). `lib/config` requires
Supabase settings in production, so this mode can never run in production. With Supabase
configured, `@supabase/ssr` is used and the seed creates the demo users via the Admin API.
That Supabase path is written but not yet exercised against a live project (Phase 6 deploy).

## D-021 — Thinking switched off for the three AI calls

Haiku 5.5 and Sonnet 5.5 think by default and thinking tokens count against `max_tokens`,
which would make the §7 caps (800/1400/2000) truncate answers. Haiku uses
`thinking: disabled` (effort low); Sonnet uses `thinking: between_tools` (effort medium).
These are short structured extractions where thinking adds cost, not quality.

## D-022 — Manual runs and plan refreshes run inline until Inngest is wired (Phase 6)

`POST /api/creators/:id/runs` authorises the user (RLS + role), then runs the pipeline
synchronously (about a second in mock mode). Phase 6 moves this to an Inngest event so the
request returns immediately; the service boundary (`requestManualRun`) stays the same.

## D-023 — Mock data anchored to `connected_at`

The mock source generates posts relative to the creator's `connected_at`, so timestamps are
stable across runs (re-runs are identical) yet recent after each reseed. The viral fixture
post's engagement boost was raised so it reads as "Strong" for every creator in the demo.
