# CLAUDE.md

Creator Baseline v1: scores each Instagram creator's posts against their own historical
baseline, summarises comment themes, and drafts a weekly content plan.

- **How to build:** `BUILD_PROMPT.md` (architecture, scoring spec, build order). It wins on architecture.
- **What to build:** `docs/requirements.md`. It wins on behaviour. Log conflicts in `docs/DECISIONS.md`.
- **Next.js 16:** read `AGENTS.md` and `node_modules/next/dist/docs/` before using a Next API.

## Commands

```
pnpm dev               # Next dev server (sign in: owner@demo.agency / creator-baseline-demo)
pnpm typecheck         # tsc --noEmit — must be clean
pnpm lint              # ESLint, includes layer-boundary rules — must be clean
pnpm test              # unit tests (scoring, AI structured output, helpers)
pnpm test:integration  # pipeline + RLS tests against TEST_DATABASE_URL (reset each run)
pnpm exec playwright test  # the one E2E path (needs a seeded, ingested DB)
pnpm db:migrate        # apply supabase/migrations to DATABASE_URL
pnpm db:seed           # demo workspace, users, 3 creators x 40 posts (re-runnable)
pnpm ingest            # run the pipeline once for every creator
pnpm db:reset          # drop + migrate + seed + ingest (local only; refuses Supabase hosts)
```
Runs end to end with `INSTAGRAM_SOURCE=mock` and `AI_PROVIDER=mock` and no external credentials.

## Layers (one-way: app → services → repositories → db)

- `app/api/**` route handlers: HTTP + Zod validation only, then call a service.
- `lib/services/` business rules and orchestration. No SQL, no HTTP, no `next/*`.
- `lib/repositories/` the only code that touches Postgres.
- `lib/scoring/` pure functions. Relative type imports only. No I/O.
- `lib/ai/client.ts` the only file that imports `@anthropic-ai/sdk`.
- `components/` render only. Never compute a score, decide a label, or touch the DB.

ESLint enforces these boundaries (`eslint.config.mjs`). Don't silence the rule; move the code.

## Hard rules

- AI drafts prose, extracts themes and proposes ideas. Deterministic code does scoring,
  labelling, storage and auth. Every model output passes a Zod schema via `generateStructured()`.
- Comments are untrusted data. Never store comment text, usernames or comment IDs. Aggregates only.
- Instagram tokens: AES-256-GCM at rest, never logged, never in a URL or API response.
- Service-role key: jobs only, never in a user-facing request path.
- RLS is enabled in the same migration that creates a table. Tenancy is per workspace.
- `post_metrics` is append-only (a trigger rejects UPDATE).
- `numeric` for rates and scores, never float. Store 4 dp, display 2 dp, never round before summing.
- No `any`, no `TODO`, no stub that silently returns empty. Out of scope means left out.
- No new dependency without a one-line justification in the phase report.
- Ask before changing the data model (BUILD_PROMPT §4) or formulas (§5) once Phase 1 is green.

## Conventions

- `PRODUCT_NAME` lives only in `lib/config.ts`. Env is parsed there with Zod (`serverEnv()`).
- Migrations: `supabase/migrations/<yyyymmddhhmmss>_<name>.sql`, never edited once applied.
- Local plain Postgres gets `supabase/local/auth-shim.sql` (auth schema + roles) automatically.
- Fixtures: `lib/fixtures/creators.ts`, deterministic for a given `now`. Seed and mock source share it.
- UI: Tailwind + shadcn/ui, Lucide icons, no emoji, en-GB formatting, Europe/London dates.
- Comments explain *why*, not *what*. Prefer boring code.

## Workflow

- Work one phase at a time (BUILD_PROMPT §13). Stop and report at the end of each phase.
- A phase is done only when typecheck, lint and tests are green.
- One conventional commit per phase. Never commit `.env.local`.
- Record every judgement call in `docs/DECISIONS.md` (decision, alternatives, why).
