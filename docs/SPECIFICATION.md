# Creator Baseline v1 — Technical specification

The engineering specification Creator Baseline v1 was built against: architecture, data
model, the exact scoring formulas, integrations, security, tests, the phased build order
and acceptance criteria.

`docs/requirements.md` is the client's requirements document and the source of truth for
**what** the product does. This file is the source of truth for **how** it is built. Where
the two conflict, this file wins on architecture and the requirements win on behaviour;
every such conflict and every judgement call is logged in `docs/DECISIONS.md`.

---

## 1. Mission

Build **v1** of a social media growth analyst for large Instagram creator accounts.
It collects each account's recent posts and metrics, scores every post against that
creator's own historical baseline, reads the comments to find audience themes, and
produces a weekly report plus a content plan. The client (a UK agency with 3 creator
accounts) views everything on a simple authenticated dashboard.

Working name: **Creator Baseline** (placeholder — do not buy domains, do not hardcode it
in more than one place: `PRODUCT_NAME` in `lib/config.ts`).

The requirements document in `docs/requirements.md` is the source of truth for **what**
to build. This file is the source of truth for **how** to build it. If the two conflict,
this file wins for architecture and the requirements doc wins for behaviour. Log the
conflict in `docs/DECISIONS.md`.

---

## 2. Non-negotiable decisions (do not re-litigate these)

| Area | Decision |
|---|---|
| Framework | Next.js (App Router) + TypeScript `strict` |
| UI | Tailwind + shadcn/ui, Lucide icons, no emoji in UI, system font stack for body |
| DB / Auth | Supabase (Postgres, RLS, Auth). `@supabase/ssr` for session handling |
| Cache / rate limit | Upstash Redis (optional in dev, required in prod) |
| Jobs | Inngest for the scheduled ingestion + report pipeline |
| AI | Anthropic Claude, **server-side only**, behind a single service layer |
| Deploy | Vercel |
| Package manager | pnpm |
| Tests | Vitest (unit/integration), Playwright (one E2E) |

**Hard rule that outranks everything:** the AI is a collaborator, not the system.
Deterministic code does all scoring, labelling, storage, and authorisation. The model only
drafts prose, extracts themes from comments, and proposes plan ideas — and every one of its
outputs passes through a Zod schema before anything reads it.

**Second hard rule:** the dashboard must be fully demoable before Instagram approves the
app. So the Instagram integration sits behind an interface with a fixture-backed
implementation. The app must run end-to-end with `INSTAGRAM_SOURCE=mock` and
`AI_PROVIDER=mock` and no external credentials at all.

---

## 3. Architecture (enforce these boundaries)

Layered, and the layers only call downward:

```
Route handler / server action   → knows HTTP, validates input, calls a service
Service                          → business rules, orchestration, no HTTP, no SQL
Repository                       → the only code that touches Postgres
```

Never skip a layer. A route handler that contains a Supabase query is a defect.

Module layout:

```
app/                        routes + pages
app/api/...                 route handlers (thin)
components/                 presentational + shadcn/ui
lib/config.ts               env parsing (zod), PRODUCT_NAME, feature flags
lib/scoring/                PURE functions: rates, baseline, r-values, score, label
lib/instagram/              types.ts, mock-source.ts, graph-source.ts, factory.ts
lib/ai/client.ts            the only file that imports the Anthropic SDK
lib/ai/structured.ts        generateStructured(schema, system, user, opts)
lib/ai/usage.ts             token + cost ledger write
lib/services/               runService, scoringService, reportService, planService, creatorService
lib/repositories/           one file per aggregate, all SQL lives here
prompts/                    report/system.ts, themes/system.ts, plan/system.ts (+ examples.ts)
jobs/                       inngest functions: scheduleTick, ingestCreator, weeklyPlan, purge
supabase/migrations/        ordered SQL migrations, RLS included
scripts/seed.ts             fixtures for 3 creators
docs/                       requirements.md, DECISIONS.md, ARCHITECTURE.md, DEMO.md
```

Import direction is one-way: `app → services → repositories → db`.
`lib/scoring` imports nothing but types. Components never import repositories.

---

## 4. Data model

Postgres via Supabase. UUID primary keys (`gen_random_uuid()`), `timestamptz` everywhere,
`numeric` for rates and scores (never float), and RLS enabled **in the same migration that
creates the table**. Multi-tenancy is per `workspace` (the client agency).

| Table | Key columns |
|---|---|
| `workspaces` | `id`, `name`, `created_at` |
| `workspace_members` | `workspace_id`, `user_id` (→ `auth.users`), `role` (`owner`\|`admin`\|`viewer`), PK `(workspace_id, user_id)` |
| `creators` | `id`, `workspace_id`, `ig_user_id`, `username`, `display_name`, `avatar_url`, `access_token_ciphertext`, `token_iv`, `token_expires_at`, `status` (`active`\|`needs_reauth`\|`disconnected`), `connected_at`, `last_synced_at` |
| `posts` | `id`, `creator_id`, `ig_media_id` (unique), `format` (`reel`\|`image`\|`carousel`), `permalink`, `posted_at`, `caption_excerpt` (≤300 chars), `duration_ms` (nullable) |
| `post_metrics` | `id`, `post_id`, `captured_at`, `reach`, `likes`, `comments`, `shares`, `saves`, `avg_watch_time_ms` (nullable), `video_views` (nullable) — append-only snapshots, one per run |
| `baselines` | `id`, `creator_id`, `format`, `computed_at`, `n_posts`, `median_reach`, `median_likes`, `median_comments`, `median_shares`, `median_saves`, `median_watch_rate` (all nullable) |
| `post_scores` | `id`, `post_id`, `run_id`, `score` num(6,4), `label` (`strong`\|`normal`\|`weak`\|`too_early`\|`baseline_building`), `r_values` jsonb, `weights_snapshot` jsonb, `signals_used` text[], `computed_at` |
| `runs` | `id`, `creator_id`, `trigger` (`schedule`\|`manual`), `status` (`queued`\|`running`\|`succeeded`\|`failed`), `started_at`, `finished_at`, `error_code`, `error_message`, `posts_seen`, `posts_scored` |
| `reports` | `id`, `creator_id`, `period_start`, `period_end`, `headline`, `what_working` jsonb, `what_not_working` jsonb, `themes` jsonb, `sentiment` jsonb, `model`, `prompt_version`, `created_at` |
| `content_plans` | `id`, `creator_id`, `week_start` (date, unique per creator), `summary`, `model`, `prompt_version`, `created_at`, `updated_at` |
| `plan_suggestions` | `id`, `plan_id`, `title`, `format`, `hook`, `reason`, `data_ref`, `suggested_date`, `status` (`proposed`\|`used`\|`not_used`), `decided_at`, `decided_by` |
| `comment_insights` | `id`, `run_id`, `creator_id`, `sentiment_positive` int, `sentiment_neutral` int, `sentiment_negative` int, `themes` jsonb, `comments_sampled` int, `model` |
| `scoring_settings` | `id`, `workspace_id`, `weights` jsonb, `photo_weights` jsonb, `cap` num, `strong_cutoff` num, `weak_cutoff` num, `min_age_hours` int, `median_window` int, `schedule_cron` text, `ai_monthly_budget_usd` num |
| `ai_calls` | `id`, `purpose`, `model`, `input_tokens`, `output_tokens`, `cost_usd` num(10,6), `latency_ms`, `ok` bool, `created_at` |
| `audit_log` | `id`, `workspace_id`, `actor_user_id`, `action`, `subject`, `metadata` jsonb, `created_at` |
| `deletion_requests` | `id`, `creator_id`, `requested_at`, `completed_at` |

Rules:

- Index `posts(creator_id, posted_at desc)`, `post_metrics(post_id, captured_at desc)`,
  `post_scores(post_id, computed_at desc)`, `runs(creator_id, started_at desc)`.
- RLS pattern: every tenant table is reachable only through `workspace_members`. Write the
  policy in the migration. Service-role key is used **only** by jobs and never in a
  user-facing request path.
- `post_metrics` is append-only. Never mutate a snapshot; compute rate at read time.
- Store nothing from a comment except aggregates. No comment text, no usernames, no IDs.

---

## 5. Scoring spec (exact — implement to the number)

Pure functions in `lib/scoring/`, no I/O. All rates are `numeric`.

**Signals and default weights**

| Signal | Source metric | Rate | Default weight |
|---|---|---|---|
| watch time | `avg_watch_time_ms` | `avg_watch_time_ms / duration_ms` | 0.35 |
| sends | `shares` | `shares / reach` | 0.25 |
| saves | `saves` | `saves / reach` | 0.20 |
| likes | `likes` | `likes / reach` | 0.10 |
| comments | `comments` | `comments / reach` | 0.10 |

**Photo weights** (no watch time; renormalised to 1):
sends 0.40, saves 0.30, likes 0.15, comments 0.15.

**Per-signal ratio**

```
r_i = x_i / median_i          (x_i = this post's rate, median_i = creator's usual rate)
r_i = clamp(r_i, 0, cap)      (cap default 5.0)
```

**Score**

```
score = Σ w_i · r_i           (weights sum to 1, so a typical post scores 1.00)
```

**Labels**

| Score | Label |
|---|---|
| `> strong_cutoff` (default 1.5) | `strong` → UI "Strong" |
| `>= weak_cutoff` (default 0.9) and `<= strong_cutoff` | `normal` → UI "Normal" |
| `< weak_cutoff` | `weak` → UI "Weak" |

**Baseline**

- Median of the creator's **own** rates over the **last `median_window` posts (default 30)
  of the same format**, excluding the post being scored and excluding posts younger than
  `min_age_hours` (default 24).
- Recompute per creator per format per run; write to `baselines`.

**Edge cases — implement exactly, and flag in `DECISIONS.md` as v1 rules to confirm**

1. Post younger than `min_age_hours` → label `too_early`, no score, no AI treatment.
2. Fewer than 5 eligible posts of that format → `baseline_building`, no score.
3. `median_i = 0` or NULL → drop that signal, renormalise the remaining weights to sum to 1,
   and record it in `signals_used`. If fewer than 2 signals survive → `baseline_building`.
4. `reach = 0` → drop the post from baseline and scoring (`too_early`).
5. Rounding: store 4 dp, display 2 dp. Never round before summing.

**Golden test:** the requirements doc's worked example must produce **1.27** from
`0.35(1.5) + 0.25(1.5) + 0.20(1.0) + 0.10(1.2) + 0.10(0.5)`. Write this as the first test,
before the implementation.

---

## 6. Instagram integration

Interface first, transport second:

```ts
interface InstagramSource {
  listRecentMedia(creator: Creator, since: Date): Promise<RawMedia[]>;
  getMediaInsights(creator: Creator, mediaId: string): Promise<RawInsights>;
  exchangeCode(code: string): Promise<{ token: string; expiresAt: Date; igUserId: string }>;
  refreshToken(token: string): Promise<{ token: string; expiresAt: Date }>;
}
```

- `mock-source.ts` returns deterministic fixtures covering reels, images, carousels, a viral
  post, a post with zero comments, and a post that is 3 hours old. Selected when
  `INSTAGRAM_SOURCE=mock`.
- `graph-source.ts` is the real implementation. Wrap every call in a timeout and a retry with
  exponential backoff; treat `429` and `5xx` as retryable, `4xx` as permanent.
- Verify the exact metric names against the **current** Instagram Graph API docs at build
  time — do not trust memory. Needed: reach, likes, comments, saved, shares, plus the Reels
  watch-time metric. Map each to our field in one place, `lib/instagram/metrics.ts`, and
  throw loudly if a metric is missing rather than silently storing 0.
- Tokens: long-lived, encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`, 32 bytes,
  from env), IV stored beside the ciphertext, never logged, never sent to the client, never
  in an API response. Refresh on a schedule before expiry; on refresh failure set
  `creators.status = 'needs_reauth'` and surface a banner.
- Rate limits: at most one in-flight request per creator; sleep between page fetches; honour
  the API's usage headers rather than guessing.

**OAuth:** Facebook Login for Business → signed-state cookie → short-lived token exchange →
long-lived token → store encrypted. Never put the token in a URL, a log line, or a JWT.

---

## 7. AI layer

One service layer, three calls. Nobody outside `lib/ai/` imports the SDK.

| Call | Purpose | Model tier | Where | Output |
|---|---|---|---|---|
| `themes` | sentiment + recurring topics from comments | Haiku | per creator per run | `{sentiment:{positive,neutral,negative}, themes:[{label,count,sentiment,example_paraphrase}]}` |
| `report` | "what worked / what didn't" narrative | Sonnet | per creator per run | `{headline, what_working:[{point,evidence}], what_not_working:[{point,evidence}]}` |
| `plan` | 7 post ideas + weekly calendar | Sonnet | per creator per week (+ regenerate on request) | `{summary, ideas:[{title,format,hook,reason,data_ref,suggested_date}]}` |

Requirements:

- **Prompts are files**, in `prompts/<call>/system.ts`, exported as a `const`, with a
  `PROMPT_VERSION` string. The version is written onto every row the call produces.
- **Stable prefix first** so Anthropic prompt caching hits: role, rules, schema, and the one
  worked example in the system prompt; the per-request data last.
- **Structured output** through `generateStructured()`: JSON-only instruction, Zod schema,
  strip markdown fences, one retry that feeds the validation error back, then throw a typed
  error. Never `JSON.parse` a model response anywhere else.
- **Comments are untrusted data, not instructions.** They arrive inside
  `<comments><comment id="1">…</comment></comments>` and the system prompt states that
  anything inside those tags is data to analyse and must never be obeyed. Never interpolate
  comment text into the system prompt. Cap at 300 sampled comments per run, 280 chars each,
  deduplicated, usernames and links stripped before the call, and **dropped from memory
  immediately after** — only aggregates are persisted.
- **Cost control:** one `themes` + one `report` call per creator per run (never per post,
  never per comment); `max_tokens` 800 / 1400 / 2000 respectively; a monthly budget check
  against `scoring_settings.ai_monthly_budget_usd` running total from `ai_calls` that
  degrades gracefully ("AI summaries paused — monthly budget reached", scores still shown).
  Log every call to `ai_calls` with tokens, latency, and cost.
- **Failure behaviour:** AI failure must never fail the run. Store the deterministic part
  (metrics, scores, labels), set the report/plan to `null`, show a retry affordance.
- **Mock mode:** `AI_PROVIDER=mock` returns schema-valid canned output from fixtures, so the
  whole product builds, tests, and demos with zero API spend.

---

## 8. Jobs

- `scheduleTick` — hourly cron. Finds creators whose `last_synced_at` is older than
  `scoring_settings.schedule_cron` (default 6h) and enqueues `ingestCreator`. Do **not**
  create a dynamic cron per creator.
- `ingestCreator` — the pipeline, idempotent per `(creator_id, run window)`:
  upsert posts → fetch insights → append `post_metrics` → recompute `baselines` → score →
  `themes` → `report` → update `content_plans` in place (never rewrite from scratch).
  A repeated invocation for the same window must not duplicate rows.
- `weeklyPlan` — Monday 06:00 Europe/London, plus on-demand from the dashboard.
- `purgeExpired` — daily housekeeping.
- Step-level retries with backoff (Inngest defaults), a `runs` row that records the failure,
  and a UI banner when the last run for a creator failed. Never leave a run stuck in
  `running`: mark orphans failed after 30 minutes.

---

## 9. HTTP surface

All JSON, all validated at the boundary with Zod, all errors in one shape:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "fields": { "…": "…" } } }
```

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/creators` | list creators in the caller's workspace |
| POST | `/api/creators/connect` | start OAuth (mock mode: create a fixture creator) |
| GET | `/api/creators/callback` | OAuth callback |
| DELETE | `/api/creators/:id` | disconnect + purge that creator's data |
| GET | `/api/creators/:id/overview` | latest scores, baseline, last run, report summary |
| GET | `/api/creators/:id/posts` | cursor-paginated, filter by label/format/date |
| POST | `/api/creators/:id/runs` | manual run (admin only, rate-limited) |
| GET | `/api/creators/:id/reports/latest` | latest report |
| GET | `/api/creators/:id/plans/current` | current week's plan |
| PATCH | `/api/suggestions/:id` | `{ status: "used" \| "not_used" }` |
| GET/PATCH | `/api/settings/scoring` | weights, cutoffs, cap, schedule, budget |
| GET | `/api/health` | build sha, migration state, last run per creator |

Status codes honestly: 401 unauthenticated, 403 wrong workspace, 404 missing, 409 duplicate,
422 validation, 429 rate-limited, 500 unexpected. Every list endpoint paginates from day one.

---

## 10. Dashboard

Pages:

1. `/login` — Supabase email+password (magic link acceptable). No self-signup; accounts are
   invited by an admin.
2. `/dashboard` — 3 creator cards: avatar, last score trend, last run status, "needs
   reauth" / "failed" badges.
3. `/accounts/[creatorId]` — the main screen: score trend line, top 5 / bottom 5 posts with
   labels, the "what worked / what didn't" report, audience themes + sentiment, link to plan.
4. `/accounts/[creatorId]/plan` — the week's plan: 7 idea cards with reason + data reference,
   a calendar strip, and a used / not used toggle per suggestion (persisted, optimistic).
5. `/settings` — scoring weights, cutoffs, cap, run frequency, AI budget. Saving these must
   not require a deploy.

UI rules (treat as acceptance criteria):

- Skeleton loaders for every async region — no spinners, no layout shift.
- Every failure has a message a non-technical client can act on, plus a retry.
  Instagram unavailable → "We couldn't reach Instagram at 14:02. We'll try again at 18:00."
- Empty states that explain the next step ("This creator needs 5 more reels before we can
  set a baseline").
- Every AI-generated section carries a small, quiet disclaimer:
  "AI-generated advice. Review before you act on it."
- Score colour is paired with a label, never colour alone (accessibility).
- Mobile-first; the client will open this on a phone. Tap targets ≥ 44px.
- No emoji, Lucide icons only, system font stack for body copy, Tailwind + shadcn/ui.
- All numbers formatted `en-GB`, percentages to 1 dp, scores to 2 dp, dates in Europe/London.

---

## 11. Security and privacy (UK GDPR)

- Secrets only in server env. Nothing sensitive under `NEXT_PUBLIC_`. A grep for
  `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `TOKEN_ENCRYPTION_KEY` in the client
  bundle must come back empty — write this as a test/CI check.
- RLS on every table, written with the table. Cross-workspace reads must fail — write an
  integration test that proves it.
- Input validation at every boundary; never interpolate a client string into SQL or into a
  sort/filter clause (allowlist sortable columns).
- Rate-limit AI-triggering and run-triggering endpoints per user (Upstash).
- Data minimisation: comments are processed in memory and reduced to counts and paraphrased
  themes; do not persist comment text or usernames; do not log prompt bodies containing
  comments.
- Disconnect or deletion request → purge posts, metrics, scores, reports, plans, insights for
  that creator, revoke the token at Meta, record in `deletion_requests` + `audit_log`.
  Deleting must be one tested code path, used by both the UI and the API.
- Never return another workspace's IDs in error messages; never expose raw DB errors.
- Follow Meta's platform terms: don't cache Instagram data beyond what's needed, don't
  re-share it, and make disconnect trivial.

---

## 12. Tests

- **Scoring (highest value, write first):** golden 1.27 example; photo weights; cap at 5.0;
  `too_early` under 24h; `baseline_building` under 5 posts; zero median renormalisation;
  reach 0; label boundaries at exactly 0.9 and 1.5.
- **AI:** `generateStructured` returns valid data for a valid fixture, retries once then
  throws on a bad fixture, and the mock provider satisfies every schema. Snapshot the
  compiled prompt (so an accidental prompt change is visible in review).
- **Integration:** one full `ingestCreator` run against `INSTAGRAM_SOURCE=mock` writes posts,
  metrics, a baseline, scores, an insight row, a report, and a plan — and running it twice
  does not duplicate.
- **Security:** cross-workspace read fails; member of workspace A cannot PATCH workspace B's
  suggestion; purged creator leaves no rows.
- **E2E (Playwright, one path):** login → dashboard → account → see scores → toggle a
  suggestion → reload → toggle persisted.
- Do not chase coverage. Do not test shadcn components or Supabase itself.

---

## 13. Build order (stop and report after each phase)

**Phase 0 — skeleton and schema.** Repo scaffold, `CLAUDE.md` (under 100 lines), env schema,
Supabase migrations with RLS, `scripts/seed.ts` with 3 creators × 40 posts of realistic
fixtures, `docs/ARCHITECTURE.md`. Done when `pnpm dev` boots and the seeded DB is queryable.

**Phase 1 — scoring engine.** Pure functions + the full test suite from §12 (scoring only).
No UI, no network. Done when the golden example returns 1.27 and every edge case is covered.

**Phase 2 — ingestion with the mock source.** `InstagramSource` interface, mock
implementation, repositories, `runService`, fixture-seeded end-to-end run, `runs` bookkeeping.

**Phase 3 — AI layer and reports.** Anthropic client, structured output, three prompt files,
mock provider, `themes` + `report` written from a real run, cost ledger, budget guard.

**Phase 4 — dashboard.** Login, dashboard, account page, plan page with the used/not-used
toggle, settings, skeletons and error states. This phase must produce the demo.

**Phase 5 — real Instagram adapter.** `graph-source.ts`, OAuth flow, token encryption and
refresh, metric mapping against live docs, backoff, reauth banner. Behind the flag; the mock
path must still work.

**Phase 6 — hardening and ship.** Scheduler wiring, purge path, RLS/security tests, the one
Playwright test, deploy to Vercel, `README.md`, `docs/DEMO.md` (a 5-minute script for the
client call).

Optional, only if Instagram approval is still pending at demo time: CSV import so real
numbers can be dropped in per post. Add it behind a flag; do not let it complicate the schema.

---

## 14. Rules of engagement

- **Never invent requirements.** If something is genuinely ambiguous and blocks you, ask at
  most 3 questions in one message, then proceed with the most conservative option and log it
  in `docs/DECISIONS.md` (decision, alternatives, why).
- **Stop at the end of every phase** with: files added/changed, tests run and their result,
  anything you had to decide, and what Phase N+1 will touch. Do not roll into the next phase
  unasked.
- **No placeholders.** No `TODO`, no `throw new Error("not implemented")`, no stubbed service
  that silently returns empty. If something is out of scope, leave it out and say so.
- **No `any`.** `tsc --noEmit` clean, ESLint clean, tests green before you call a phase done.
- **No new dependency** without a one-line justification in the phase report.
- **Commit per phase**, conventional commits, one logical change each.
- **Never commit secrets.** `.env.example` documents every variable; `.env.local` is ignored.
- Business logic lives in `lib/scoring` and `lib/services` only. Components render; they never
  calculate a score, decide a label, or touch Supabase directly.
- Prefer boring, readable code over clever code. Comment *why*, never *what*.
- Ask before changing the data model in §4 or the formulas in §5 once Phase 1 is green.

---

## 15. Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server + jobs only
DATABASE_URL=                   # migrations + scripts
ANTHROPIC_API_KEY=              # server only
AI_PROVIDER=anthropic|mock
INSTAGRAM_SOURCE=graph|mock
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=
TOKEN_ENCRYPTION_KEY=           # 32-byte base64
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
APP_BASE_URL=
```

---

## 16. Acceptance criteria — v1 is done when all of these are true

1. With `INSTAGRAM_SOURCE=mock` and `AI_PROVIDER=mock`, a fresh clone + seed + `pnpm dev`
   runs a full pipeline and renders a complete account page with scores, report, themes, and
   a plan — no external credentials.
2. The worked example post scores `1.27` (test, not eyeball), and every §5 edge case has a
   passing test.
3. Running the pipeline twice for the same window produces identical scores and no duplicate
   rows, metrics, reports, or plan suggestions.
4. Editing a weight in `/settings` changes the next run's scores without a redeploy, and old
   scores keep the `weights_snapshot` they were computed with.
5. A failed Instagram call produces a `runs` row with a readable error and a banner on the
   dashboard; the rest of the page still renders.
6. An AI failure produces scores and an empty report with a retry, never a failed run.
7. A second workspace's user cannot read or modify anything in the first workspace (test).
8. Deleting a creator removes every row that references them and revokes the token.
9. `grep` of the built client bundle finds no secret keys.
10. One Playwright test passes on a clean database.
11. No comment text or username is stored anywhere in the database (check the schema).
12. Deployed to Vercel and reachable at `APP_BASE_URL`, with `/api/health` green.

---

## 17. Out of scope for v1 (do not build, do not scaffold)

Auto-posting, comment replies, any platform other than Instagram, follower or view
prediction, more than 3 accounts, a trained model that tunes the weights itself (settings
only, so it can be added later), billing/subscriptions, white-labelling, native mobile apps,
real-time websockets, chat with your data, and any AI feature not listed in §7.
