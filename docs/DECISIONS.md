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

## D-024 — Reels: average watch time compared with the creator's own median (Confirm)

The requirements table defines watch time as `avg_watch_time_ms / duration_ms`, but the
Instagram Graph API exposes `ig_reels_avg_watch_time` and no media length (the IG Media
reference has no duration field). Dividing by a value we cannot get would make 35% of a
Reel's score uncomputable on real data.

Decision: the watch-time rate is the raw average watch time in milliseconds, and the
per-signal ratio divides it by the creator's median average watch time, like every other
signal. Alternatives: keep dividing by fixture durations only, so mock and real scores
differ; drop watch time on real data and renormalise, which silently changes the weights
the client signed off; ask the client for a duration per post, adding manual work. The
golden 1.27 example is unaffected because its Reels share a length.

Client should confirm that the §5 wording "share of the video watched" becomes "average
time watched, compared with their usual".

## D-025 — Insights that are not available yet do not fail the run

Instagram returns an empty insights data set when a metric is unavailable; data can lag up
to 48 hours. `mapInsights` still throws when a payload is present but a requested metric is
missing, so API drift is loud. The Graph source turns an empty data set into `NO_DATA`; the
pipeline stores the post without a new snapshot and a later run picks it up. The post shows
as `too_early` (no metrics) until then.

Alternatives: fail the whole run because one post has no data (brittle); store zeros (would
pull the creator's baseline down). Why: the client-facing pipeline stays reliable without
pretending data exists.

## D-026 — `getMediaInsights` takes the media item, not just its id

Which metrics can be requested depends on `media_product_type`: `ig_reels_avg_watch_time`
is Reels-only. Passing the item the pipeline already has avoids an extra
`GET /{media-id}` per post (40 calls per run). The §6 signature changed; behaviour did not.

Alternatives: fetch each media object again (extra calls, extra failure points); request
every metric on every post (Meta rejects unsupported metrics).

## D-027 — Tokens refresh at the start of a run

Long-lived tokens last about 60 days. `resolveAccessToken` refreshes when the token expires
within 7 days, at the start of each ingest (every 6 hours by default). A transient refresh
failure keeps using a token that still has more than a day left; an auth failure or less
than a day left marks the creator `needs_reauth`. Phase 6's scheduler inherits this without
a separate refresh cron.

Alternatives: a daily refresh job (another schedule for no benefit); refreshing on every
run (needless writes).

## D-028 — OAuth scopes, and optional Facebook Login for Business configuration

Without `INSTAGRAM_LOGIN_CONFIG_ID`, the dialog requests `instagram_basic`,
`instagram_manage_insights`, `pages_show_list` and `pages_read_engagement`. With a
configuration id, the dialog sends `config_id`, `response_type=code` and
`override_default_response_type=true` instead of scopes. `business_management` is not
requested: the four above cover media, insights and comments.

Alternatives: request `business_management` too (broader than needed); use Meta's JS SDK
(the flow is manual and server-side, so no SDK is needed).

## D-029 — Connecting is an upsert; reconnecting must match the account

A completed login inserts by `(workspace_id, ig_user_id)` or updates that row, so connecting
the same Instagram account twice never hits the unique key. A reconnect started from a
creator carries `creatorId` in the signed state and is rejected unless the login's Instagram
user id matches that creator; the user is then told to use "Connect account". Only owners
and admins may connect. Reconnecting clears `last_synced_at`, so the next scheduled run
fetches fresh data.

Alternatives: create a duplicate row (two cards for one account); silently repoint a
creator to a different Instagram account (its history would describe someone else).

## D-030 — The mock source uses the real OAuth routes

`MockInstagramSource.authorizationUrl` redirects straight to `/api/creators/callback` with a
fixture key as the code, so the connect/reconnect UI, signed state and callback are
exercised end-to-end without a Meta app. The optional `?account=` on the connect route
chooses a fixture. There is no automatic run after connecting: the first update is manual
("Update now") or the next scheduled run (Phase 6).


## D-031 - Local mock mode derives a token key from SESSION_SECRET

Production and \INSTAGRAM_SOURCE=graph\ always require \TOKEN_ENCRYPTION_KEY\; \lib/config\
refuses to boot without it. Local mock mode may leave it unset so the documented
\".env.local needs only DATABASE_URL\" setup keeps working, but fixture logins still go through
the real encryption path. In that case the key is derived from \SESSION_SECRET\ with HKDF
label \creator-baseline/token-encryption/v1\, separate from the OAuth-state label, so one
secret is never used raw for two purposes. Setting the real key later makes the old mock
tokens undecryptable, which surfaces as \
eeds_reauth\ and a reconnect; only fixture accounts
are affected.

Alternatives: refuse mock connects without a key (breaks the one-variable local setup and
the demo); store mock tokens in plaintext (a second code path that would never be tested).

## D-032 - One hourly tick fans out events; no cron per creator

`scheduleTick` runs hourly and asks `scheduleService.dueCreatorIds()` which creators are past
their workspace's interval, then emits one typed `creator/sync.requested` event per creator.
The interval lives in `scoring_settings.schedule_cron` (1-24 hours), and the due rule is
`last_synced_at + interval <= now`, with a null `last_synced_at` always due. Inngest executes
`ingestCreator` as a durable, retryable step per event, with per-creator concurrency 1.
Only `active` creators are due: `needs_reauth` waits for a reconnect and `disconnected`
rows are excluded, so the scheduler cannot spin on a rejected token.

Alternatives: a dynamic cron per creator (Inngest schedules would need reconciling on every
settings change and every connect/disconnect); a cron per interval bucket (three schedules
and still a fan-out step); polling every minute (needless invocations).

Why: §8 explicitly asks for this shape. One schedule is easy to reason about, a settings
change takes effect on the next tick, and the interesting rule is a pure function tested
without a database.

## D-033 - Disconnect and deletion are one path; revocation comes after the purge

`deleteCreator` is the only way a creator is removed. The account page's button and
`DELETE /api/creators/:id` both call it. In order: check membership and owner/admin role
(viewers get 403), insert a `deletion_requests` row, delete the creator row and let the
schema cascade every child row, mark the request complete, write `audit_log`, then revoke
the app's permissions at Meta with the decrypted token. A revocation failure is logged by
error class only and does not undo the deletion. `purgeExpired` retries any request whose
completion write was lost.

Alternatives: soft-delete first and purge later (keeps the personal data the client asked us
to remove, and every query would need a filter); revoke at Meta before deleting (a Meta
outage would block deletion and leave the user unable to remove an account); separate
"disconnect" and "delete" paths (two behaviours to test, and the requirement says deleting
must be one tested path).

Why: the local purge is the part we control and can prove; Meta is an external dependency.
The deletion record and audit entry are written in the same transaction as the delete, so a
successful purge can never be undocumented.

## D-034 - `/api/health` is authenticated and workspace-scoped

The health report contains the deploy commit, the migration ledger and the last run per
creator (status, times, error code). Creator handles are tenant data, so the endpoint requires
a session and reports only the caller's workspace; it is not a public liveness probe. A
degraded report is HTTP 200 with `status: "degraded"`; 401/403 still mean the caller could not
ask.

Alternatives: a public endpoint returning build and migration state only (safe but cannot
answer "are this client's creators running?"); HTTP 503 for degraded (a monitor could not
tell it apart from a signing or session failure, and the dashboard's fetch helper treats
non-2xx as an error).

Why: acceptance criterion 12 asks for `/api/health` to be green on the deployment, and the
agency's real question is whether each creator is syncing. Keeping it authenticated means no
new unauthenticated surface.

## D-035 - `purgeExpired` is housekeeping, not a retention policy

The daily job does two things: mark runs still `running` after 30 minutes as failed
(`ORPHANED`), and finish deletion requests that never completed. It does **not** delete old
reports, scores or metrics. R7 asks to keep past reports, and the baseline is only meaningful
with history.

Alternatives: delete data older than 90 days (contradicts R7 and would silently degrade the
median); leave orphaned runs until the next ingest (the affected creator's card shows
"running" indefinitely, and a crash exactly at the wrong time could strand it for hours).

Why: it closes the two failure modes §8 names ("never leave a run stuck in running", finish a
purge) without inventing a retention rule the client did not ask for.

## D-036 - Real workspaces and members are created by a script, not a sign-up page

The spec has members "invited by an admin" but no flow existed outside the demo seed, so a real
deployment had no way to create its first owner. `pnpm workspace:create --name ... --owner ...`
(also `--admin`, `--viewer`) creates or reuses the workspace, its default scoring settings and the
memberships, and creates missing users in Supabase Auth with a password typed at a hidden prompt.

Alternatives: Supabase invite emails (the app has no page to accept an invite or set a password,
and Supabase's built-in mailer is rate-limited and restricted to project members), or an in-app
admin screen (more surface to secure and test than one agency needs in v1). Why: one re-runnable
command covers the first owner and later teammates, and keeps passwords out of shell history.

## D-037 - Instagram Login (no Facebook Page) is the default; its token rules differ

`INSTAGRAM_LOGIN_TYPE=instagram` (default) uses Instagram API with Instagram Login, so creators
connect without a linked Facebook Page; `facebook` keeps the Facebook Login path. Checked against
Meta's Instagram Platform docs on 14 Nov 2026:

- **Revocation:** no revoke endpoint is documented (the token reference says deleting "is not
  supported"). On disconnect the purge deletes our only copy of the token; Meta expires it within
  60 days, or the creator removes the app in Instagram settings. `revokeToken` is a no-op for
  this login type only.
- **Token in URL:** the long-lived exchange and the refresh are documented only as GETs with the
  token (and, for the exchange, the app secret) in the query string. These two server-to-server
  calls are the only exception to "tokens never in a URL"; the URL is never logged or returned.
- **Account id:** `/me` `user_id` is the professional account id the media endpoints take; `id`
  and the code exchange's `user_id` are app-scoped and are not used. No `user_id` means the
  connection fails rather than storing an id every later call would reject.
- Responses are accepted flat or wrapped in `data[0]`, because the docs show both.

Alternatives: keep Facebook Login only (every creator would need a Facebook Page linked);
send tokens in a header (not documented for these endpoints, so it could break silently).

## D-038 - Unified Login is the default, because new Meta apps cannot use Instagram Login

The client's Meta app (created Nov 2026) shows "API setup with Instagram login is not available for
newer apps". `INSTAGRAM_LOGIN_TYPE=unified` uses Instagram API with Unified Login: the Facebook
dialog with a configuration id (`INSTAGRAM_LOGIN_CONFIG_ID`), the Meta app id and secret, a
business-integration system-user token, and `GET /me/assigned_instagram_accounts` on
graph.facebook.com. No Facebook Page is needed; the client needs a business portfolio.
Permissions: `instagram_basic`, `instagram_manage_insights`, `instagram_manage_comments`.

- The configuration is set to never expire, so `token_expires_at` is null and no refresh runs. If
  Meta does issue an expiring token, refresh fails as AUTH and the client reconnects; the
  token-management API would need `business_management`, which v1 does not request.
- One connection must share exactly one Instagram account, so each creator keeps its own token
  and disconnect. Several accounts in one login are refused with a clear message.
- No revoke endpoint is documented; the client removes the app under Business Settings >
  Integrations > Connected apps. The purge still deletes our copy (as D-037).
- Meta requires an HTTPS redirect URL, so local testing needs a tunnel or the deployed URL.

Alternatives: Facebook Login via `/me/accounts` (needs a Page per creator); Instagram Login (not
offered to this app).

## D-039 - Gemini added as an AI provider (overrides BUILD_PROMPT §2 "Anthropic") (Confirm)

The owner has no budget for an Anthropic key before the deadline; a Google AI Studio key on the
free tier is available. `AI_PROVIDER=gemini` adds `lib/ai/gemini.ts` behind the existing
`AiProvider` interface, so `generateStructured()`, the Zod schemas, the retry and the ledger are
unchanged. Plain fetch to the REST API: no new dependency. Anthropic stays the default for paid use.

- Model: `gemini-3.5-flash`, falling back to `gemini-flash-lite-latest` when the main model is
  still 429/503/timing out after two retries (the free tier often reports "high demand").
  Checked 14 Nov 2026: 2.5 models are closed to new keys; `thinkingLevel: "minimal"` works on
  both models, `thinkingBudget: 0` is rejected by the lite one.
- Cost: free tier, so `ai_calls.cost_usd` is 0 and the monthly AI budget never trips. The ledger
  now prices by the model that answered, not the Claude id the services request.
- Key in the `x-goog-api-key` header, never the URL; error bodies are not echoed (they can quote
  comments).

**Privacy - client must confirm:** on Google's free tier, prompts and responses may be used by
Google to improve its products and may be reviewed by people. The themes call sends recent
comment text (public, but personal data under UK GDPR). Before real creators' comments go through
it, the client should accept that, or move to a paid Gemini tier or Anthropic, where inputs are
not used for training.

Alternatives: stay on mock (real creators would see sample text presented as analysis); wait for
an Anthropic key (no budget).

## D-040 - Creator logins see only their own account; people join by invite link

Resolves D-011: the client confirmed on 14 Nov 2026 that a creator must see only their own
results. This changes the data model, at the client's request.

- **Creator role.** `workspace_members.role` gains `creator`, with a nullable `creator_id`.
  `can_access_creator()`, which every creator-scoped policy already called, now lets a creator
  member through only for their own creator; `creators_select` uses it too, and a creator sees
  only their own membership row. Staff (owner/admin/viewer) see every creator as before.
  `/api/health` (lists every creator) refuses creators.
- **Connecting.** A creator login may start Connect once, while unlinked, and the account it
  connects is linked to it; after that it may only reconnect that account.
- **Invites.** Owners and admins create a link in Settings (email + role: admin, viewer or
  creator). The token is 32 random bytes, stored only as a SHA-256 hash, single use, 7 days.
  The invitee sets their own password on `/invite/<token>`; the account is created through
  Supabase's public sign-up (anon key), so the service-role key stays out of request paths.
  Membership and invite rows are written in system scope after the service's role checks,
  because auth.users emails are not visible through RLS. Removing a member keeps their data;
  the last owner cannot be removed.
- **Supabase setting required:** Authentication > Email > "Confirm email" off. With it on,
  sign-up returns no session and the invite page says so. Trade-off: anyone can create an
  empty Supabase account with the public key; it has no membership, so RLS shows it nothing.

Alternatives: Supabase invite emails (need custom SMTP; the built-in mailer only reaches the
project team, and the app had no page to accept them); admin-set passwords (the admin would know
every password); keep `pnpm workspace:create` only (needs a terminal for every new person).

Also: the integration suite and seed now blank out live Supabase/Upstash/AI settings. On
14 Nov a test run with live keys in `.env.local` created the two demo users in the live Supabase
project; they had no membership and were deleted the same day.
