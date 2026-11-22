# Creator Baseline

[![CI](https://github.com/AsanteAigu/Creator-Baseline/actions/workflows/ci.yml/badge.svg)](https://github.com/AsanteAigu/Creator-Baseline/actions/workflows/ci.yml)

Instagram analytics for agencies that manage creators. Creator Baseline scores every post against
**that creator's own** historical baseline, summarises what the audience is saying in the comments,
and drafts a weekly content plan grounded in the creator's real results.

**Live:** <https://creator-baseline-three.vercel.app>

> A score of 1.00 means "a typical post for this creator in this format". Above 1.50 is Strong,
> below 0.90 is Weak. 2,000 reach can be a flop for one creator and a record for another; the
> baseline is what makes the number mean something.

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Testing](#testing)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Documentation](#documentation)

## Features

- **Connect accounts** through Meta's Unified Login. One login can share several professional
  accounts; each becomes its own creator with its own encrypted token.
- **Ingestion pipeline** reads up to a year of posts with reach, likes, comments, shares, saves,
  views and Reel watch time. It runs hourly through Inngest or on demand, and is idempotent per
  creator and hour.
- **Deterministic scoring**: per-format medians over the last 30 posts, capped ratios, and weighted
  signals. It is pure functions with a golden test ([spec](docs/SPECIFICATION.md#5-scoring-spec-exact--implement-to-the-number)).
- **AI analysis** with guardrails: comment themes, a "what's working" report and a seven-idea weekly
  plan. Every model reply is validated with Zod, every point must cite a real post and number, and
  spend is capped per workspace.
- **Dashboard**: portfolio overview, account analytics over 28 days, 90 days or 12 months (score
  trend, weekly reach, format and weekday breakdowns, top and bottom posts), and the weekly plan with
  used / not used feedback.
- **Multi-tenant and private by design**: Postgres row-level security on every table, four roles
  (owner, admin, viewer, creator), and no comment text, commenter names or comment IDs are ever stored.

## Tech stack

| Concern         | Choice                                                                      |
| --------------- | --------------------------------------------------------------------------- |
| App             | Next.js 16 (App Router), React 19, TypeScript (`strict`, `noUncheckedIndexedAccess`) |
| UI              | Tailwind CSS 4, shadcn/ui primitives, Lucide icons, hand-built SVG charts   |
| Data            | Supabase Postgres with RLS, Supabase Auth, SQL migrations                   |
| Jobs            | Inngest (hourly tick, per-creator ingestion, weekly plan, daily purge)      |
| AI              | Google Gemini (production), Anthropic Claude (supported), deterministic mock |
| Rate limiting   | Upstash Redis                                                               |
| Validation      | Zod at every boundary (env, HTTP input, AI output)                          |
| Tests           | Vitest (unit and integration against real Postgres), Playwright (E2E)       |
| Hosting         | Vercel, deployed from `main`                                                |

## Architecture

```mermaid
flowchart TD
    Browser["Browser"] --> App["app/ — pages and route handlers<br/>HTTP + Zod validation only"]
    Jobs["jobs/ — Inngest functions"] --> Services
    App --> Services["lib/services/ — business rules and orchestration"]
    Services --> Repos["lib/repositories/ — all SQL"]
    Services --> Scoring["lib/scoring/ — pure functions"]
    Services --> AI["lib/ai/ — provider clients + generateStructured()"]
    Services --> IG["lib/instagram/ — Graph API adapter + mock"]
    Repos --> DB[("Supabase Postgres<br/>RLS on every table")]
```

Dependencies only point downward: `app → services → repositories → db`. Background jobs enter at
the service layer, so a scheduled run and the "Update now" button execute the same code. The
boundaries are enforced by `no-restricted-imports` rules in [`eslint.config.mjs`](eslint.config.mjs),
so a violation fails `pnpm lint`.

The rules the code is built to:

- AI drafts prose, extracts themes and proposes ideas. Deterministic code does scoring,
  labelling, storage and authorisation.
- `post_metrics` is append-only (a trigger rejects `UPDATE`). Rates and scores are `numeric`,
  stored to 4 dp and shown to 2 dp.
- Instagram tokens are AES-256-GCM encrypted at rest and are never logged, never put in a URL and
  never returned in an API response.
- The service-role key is used only by background jobs, never in a user request path.

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

```
app/                    Next.js routes
  (app)/                  authenticated pages: dashboard, accounts/[creatorId], plan, settings
  api/                    route handlers (creators, settings, suggestions, health, inngest)
  login/, invite/         public entry points
components/
  account/                account page sections (analytics cards, report, themes, banners)
  charts/                 SVG charts and stat tiles
  plan/, settings/        feature components
  ui/                     shadcn/ui primitives
lib/
  services/               business logic: runs, scoring, reports, plans, connections, members
  repositories/           the only code that touches Postgres
  scoring/                pure scoring maths (no I/O)
  instagram/              Graph API client, OAuth, token crypto, mock source
  ai/                     provider interface, Gemini/Anthropic/mock clients, structured output
  auth/, db/              session resolution and database scopes
  config.ts               environment parsing (Zod) and PRODUCT_NAME
prompts/                versioned prompts for themes, report and plan
jobs/                   Inngest functions
supabase/migrations/    ordered SQL migrations, RLS enabled with each table
scripts/                migrate, seed, ingest, demo, workspace bootstrap, client-secret scan
tests/integration/      pipeline, RLS, connection, purge and health tests
e2e/                    the Playwright path
docs/                   architecture, specification, decisions, requirements, demo script
```

Unit tests sit next to the code they cover (`*.test.ts`).

## Getting started

**Requirements:** Node 22 (see [`.nvmrc`](.nvmrc); 20.9+ works), pnpm 10, and a local Postgres.
Docker is not needed: `pnpm db:migrate` applies the same SQL that Supabase would, plus a small auth
shim for plain Postgres.

### Quickest path: local demo

```bash
pnpm install
cp .env.example .env.local
# set DEMO_DATABASE_URL to a local database, e.g.
# postgres://postgres:password@localhost:5432/creator_baseline_demo
pnpm demo              # migrates, seeds three demo creators, runs the pipeline, starts the app
```

Open <http://localhost:3000> and sign in as `owner@demo.agency` / `creator-baseline-demo`.
The demo runs with mock Instagram and mock AI, needs no external credentials, and refuses to run
against anything but a local database. `pnpm demo --reset` rebuilds the data with posts dated
around today.

### Full development setup

```bash
cp .env.example .env.local     # set DATABASE_URL and SESSION_SECRET (32+ chars)
pnpm db:migrate
pnpm dev
```

With `INSTAGRAM_SOURCE=mock` and `AI_PROVIDER=mock` only `DATABASE_URL` and `SESSION_SECRET` are
needed. Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

To run the background jobs locally, start the Inngest dev server alongside `pnpm dev`:

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

## Scripts

| Command                         | Purpose                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`                      | Next.js dev server                                               |
| `pnpm demo [--reset]`           | Local demo on its own database with mock Instagram and AI        |
| `pnpm build` / `pnpm start`     | Production build / serve                                         |
| `pnpm check`                    | Format check, typecheck, lint and unit tests (the pre-push gate) |
| `pnpm typecheck`                | `tsc --noEmit`                                                   |
| `pnpm lint`                     | ESLint, including the layer-boundary rules                       |
| `pnpm format` / `format:check`  | Prettier                                                         |
| `pnpm test` / `test:watch`      | Unit tests                                                       |
| `pnpm test:integration`         | Integration tests against `TEST_DATABASE_URL` (reset each run)   |
| `pnpm test:e2e`                 | Playwright end-to-end path (needs a seeded database)             |
| `pnpm check:secrets`            | After a build, asserts no server-only secret reached `.next/static` |
| `pnpm db:migrate`               | Apply pending migrations                                         |
| `pnpm db:seed` / `db:reset`     | Seed demo data / drop, migrate, seed and ingest (local only)     |
| `pnpm ingest [username]`        | Run the pipeline once for every creator, or one                  |
| `pnpm workspace:create`         | Bootstrap a production workspace and its owner                   |

`db:reset` refuses to run against a Supabase-hosted database, and `pnpm demo` only runs against a local one.

## Testing

| Suite       | What it covers                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Unit        | Scoring (the golden 1.27 example and every edge case), Graph client retries and pacing, Graph source mapping, AI structured output and prompt snapshots, analytics, scheduling |
| Integration | A full ingestion run and its idempotency, cross-workspace RLS denial, roles, connection and multi-account login, token encryption, disconnect and purge, orphaned runs, health |
| End-to-end  | Sign in → overview → account → scores → mark a plan idea → reload → persisted                          |

Integration tests run against a real Postgres that is reset on every run. They blank every live
credential, so they can never reach Supabase, Upstash or an AI provider.

[CI](.github/workflows/ci.yml) runs the format check, typecheck, lint and unit tests, the
integration suite against a Postgres service container, and a production build followed by the
client-bundle secret scan, on every push and pull request.

## Configuration

Every variable is documented in [`.env.example`](.env.example) and parsed lazily with Zod in
[`lib/config.ts`](lib/config.ts). Errors name the offending variables without echoing their values.

| Group     | Variables                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------- |
| Supabase  | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` |
| Instagram | `INSTAGRAM_SOURCE`, `INSTAGRAM_LOGIN_TYPE`, `INSTAGRAM_LOGIN_CONFIG_ID`, app ID and secret, `INSTAGRAM_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` |
| AI        | `AI_PROVIDER` (`gemini`, `anthropic` or `mock`), `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`           |
| Jobs      | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`                                                      |
| Platform  | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `APP_BASE_URL`                             |

Production refuses to boot without Supabase, the token key, Upstash and Inngest.

## Deployment

Vercel deploys `main` automatically.

1. Create a Supabase project and apply `supabase/migrations/` (`DATABASE_URL=... pnpm db:migrate`).
2. Create the owner's workspace with `pnpm workspace:create`.
3. Import the repository into Vercel and set the production variables from `.env.example`.
4. In the Meta app, add `<origin>/api/creators/callback` as a valid OAuth redirect URI and create a
   Unified Login configuration.
5. Point an Inngest Cloud app at `<origin>/api/inngest`.
6. While signed in, check `GET /api/health`. It reports the commit, the migration ledger and the
   latest run per creator.

## Documentation

| Document                                        | Contents                                                        |
| ----------------------------------------------- | --------------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)   | Layers, data model, security model, pipeline, jobs, integrations |
| [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) | The technical specification the system is built to              |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)         | Every judgement call, with the alternatives considered          |
| [`docs/requirements.md`](docs/requirements.md)   | The client's requirements document                              |
| [`docs/DEMO.md`](docs/DEMO.md)                   | The client demo script                                          |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)             | Workflow, conventions and the definition of done                |
