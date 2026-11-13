# Creator Baseline

A social-media growth analyst for large Instagram creator accounts. It collects each
creator's recent posts, scores every post against that creator's own historical baseline,
reads recent comments for audience themes, and produces a weekly report and content plan on
an authenticated dashboard.

Built for a UK agency with three creator accounts. Working name only: change `PRODUCT_NAME`
in `lib/config.ts` when the real one lands.

- **Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind + shadcn/ui, Supabase
  Postgres with row-level security, Inngest for schedules and events, Anthropic for the
  written analysis, Upstash for rate limiting.
- **No credentials needed for the demo:** `INSTAGRAM_SOURCE=mock` and `AI_PROVIDER=mock`
  serve deterministic fixtures through the real pipeline and the real UI.

## Quick start

Requirements: Node 20.9+, pnpm 10, and a Postgres database (local or Supabase). Docker is
not required; `pnpm db:migrate` applies the same SQL files Supabase would.

```bash
pnpm install
cp .env.example .env.local          # then set DATABASE_URL and SESSION_SECRET
pnpm db:reset                       # migrate, seed 3 creators x 40 posts, run the pipeline
pnpm dev
```

Open <http://localhost:3000> and sign in with `owner@demo.agency` /
`creator-baseline-demo` (or `viewer@demo.agency` for the read-mostly role). Set
`SEED_DEMO_PASSWORD` before seeding to change it.

`SESSION_SECRET` must be at least 32 characters. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next dev server |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint, including the layer import rules |
| `pnpm test` | Unit tests (scoring, AI, Graph client, scheduling) |
| `pnpm test:integration` | Full-pipeline, RLS, connection and purge tests against `TEST_DATABASE_URL` |
| `pnpm db:migrate` | Apply pending migrations (`--reset` drops the app schema first) |
| `pnpm db:seed` | Seed three creators, 40 posts each, and two demo users |
| `pnpm ingest [username]` | Run the pipeline once for every creator or one of them |
| `pnpm db:reset` | Migrate, seed and ingest — the clean demo state |
| `pnpm check:secrets` | After `pnpm build`: assert no server-only secret is in `.next/static` |
| `pnpm exec playwright test` | The one end-to-end path (needs `pnpm db:reset`) |

## How it fits together

```
app/ + components/        pages, route handlers, rendering
        │
lib/services/             business rules and orchestration
        │
lib/repositories/         every SQL statement
        │
Supabase Postgres         RLS on every table; tenancy is the workspace
```

`lib/scoring/` is pure maths and has no I/O. `lib/ai/` and `lib/instagram/` put external
services behind interfaces with mock implementations. `jobs/` wires the same services to
Inngest. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data model and the
security model, and [`docs/DECISIONS.md`](docs/DECISIONS.md) for every judgement call.

### Jobs and schedules

One Inngest app (`creator-baseline`) registered at `/api/inngest`:

| Function | Schedule | Work |
|---|---|---|
| `schedule-tick` | hourly | finds creators past their workspace interval and emits `creator/sync.requested` |
| `ingest-creator` | on event | runs the ingestion pipeline for one creator |
| `weekly-plan` | Monday 06:00 Europe/London | writes the week's plan for each active creator |
| `purge-expired` | daily 03:30 Europe/London | fails stranded runs and finishes interrupted deletions |

The interval is set per workspace in `/settings` (1–24 hours; default 6). It is not a cron
per creator: the hourly tick is the only schedule, and the due check is in
`lib/services/scheduleService.ts`. Locally, jobs are inert unless you run the Inngest dev
server; the dashboard's "Update now" exercises the same pipeline inline.

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

## Configuration

Every variable is documented in [`.env.example`](.env.example). The important groups:

- **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser-safe),
  `SUPABASE_SERVICE_ROLE_KEY` (server/jobs only), `DATABASE_URL` (migrations and scripts).
- **Instagram:** `INSTAGRAM_SOURCE=mock|graph`, app id/secret, redirect URI, and a 32-byte
  base64 `TOKEN_ENCRYPTION_KEY` for token encryption and OAuth state. Local mock mode derives
  a key from `SESSION_SECRET` when it is unset.
- **AI:** `AI_PROVIDER=mock|anthropic` and `ANTHROPIC_API_KEY`.
- **Jobs:** `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.
- **Production:** also requires Upstash REST credentials, which make rate limits shared
  across serverless instances.

`lib/config.ts` validates all of this lazily with Zod and names the offending variables
without echoing values.

## Deploying to Vercel

1. Create a Supabase project, apply `supabase/migrations/*.sql` (`supabase db push`, or
   `DATABASE_URL=... pnpm db:migrate`), and seed it if this is the demo environment.
2. Import the repo into Vercel as a Next.js project.
3. Add every variable from `.env.example` that the production rules in `lib/config.ts`
   require. Production refuses to boot without Supabase, `TOKEN_ENCRYPTION_KEY`, Upstash and
   Inngest keys.
4. Set `APP_BASE_URL` and `INSTAGRAM_REDIRECT_URI` to the deployed origin, and add the
   callback URL to the Meta app.
5. In Inngest Cloud, create an app and point it at `https://<domain>/api/inngest`; the
   signing key from that app goes into `INNGEST_SIGNING_KEY`.
6. Deploy, then check `GET /api/health` while signed in. It reports the commit, migration
   count and the last run per creator. A degraded report is still HTTP 200.

`/api/inngest` declares a 300-second function limit, which needs Vercel Pro. On Hobby,
lower `maxDuration` in `app/api/inngest/route.ts`; the ingestion step then has 60 seconds,
which is enough for the three demo creators but may need splitting for a slower real account.

## Tests

- **Unit** — the scoring golden example and every edge case, AI structured-output retries,
  prompt snapshots, Graph client retry/pacing, and the scheduler's due check.
- **Integration** — one full `ingestCreator` run and its idempotency, cross-workspace RLS
  denial, role rules, token encryption/refresh, purge/disconnect (zero child rows, audit +
  deletion record, token revocation), orphan-run recovery, and the health report.
- **End-to-end** — one Playwright path: login → dashboard → account → scores → toggle a plan
  suggestion → reload → persisted.

Integration tests reset `TEST_DATABASE_URL` on every run and never touch the demo database.

## Scope and open questions

v1 is one workspace, three creators, Instagram only, no auto-posting, no billing, no
prediction. The client's requirements document left a few answers open; they are logged in
`docs/DECISIONS.md` and do not block the demo:

- the final three creator handles (fixtures stand in),
- report cadence (weekly is implemented, and the report refreshes each run),
- per-creator visibility (v1: everyone in the workspace sees every creator),
- watch-time wording and the exact Reel metric (uses `ig_reels_avg_watch_time`).

Optional CSV import (if Instagram approval is still pending at demo time) is documented but
deliberately **not built**: it would add a second ingest path to test and maintain.

## Demo

The five-minute client call script is in [`docs/DEMO.md`](docs/DEMO.md).
