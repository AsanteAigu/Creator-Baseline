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
