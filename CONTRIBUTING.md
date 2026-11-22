# Contributing

## Workflow

1. Branch from `main`.
2. Make the change, keeping to the layer rules below.
3. Run `pnpm check`, plus `pnpm test:integration` if you touched services, repositories, jobs
   or migrations.
4. Open a pull request using the template. CI must be green before merging. Vercel deploys
   `main` automatically.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat(ui): …`, `fix(instagram): …`, `docs: …`, `chore: …`, `refactor: …`, `test: …`.

## Definition of done

- Typecheck, lint, format check and all tests are green.
- Any judgement call is recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md) with the
  alternatives considered.
- UI changes have been checked in a real browser at desktop (1280 × 720) and mobile
  (375 × 812) widths.

## Architecture rules

Dependencies only point downward: `app → services → repositories → db`. ESLint enforces this;
if the rule fires, move the code rather than silencing the rule.

| Layer               | Responsibility                                  | Must not                                   |
| ------------------- | ----------------------------------------------- | ------------------------------------------ |
| `app/api/**`        | HTTP and Zod input validation, then one service call | query the database or compute scores  |
| `lib/services/`     | Business rules and orchestration                | import `postgres`, `@supabase/*` or `next/*` |
| `lib/repositories/` | All SQL and row mapping                         | contain business rules                     |
| `lib/scoring/`      | Pure scoring functions                          | perform I/O or import non-relative modules |
| `lib/ai/`           | Provider clients and `generateStructured()`     | be called per post or per comment          |
| `components/`       | Rendering only                                  | import repositories, compute scores or decide labels |

## Rules that are not negotiable

- AI only drafts prose, extracts themes and proposes ideas. Every model output passes a Zod
  schema via `generateStructured()`. Scoring, labels, storage and authorisation stay deterministic.
- Comments are untrusted input. Never store comment text, usernames or comment IDs; aggregates only.
- Instagram tokens are AES-256-GCM encrypted at rest and never logged, put in a URL or returned.
- The service-role key is for background jobs only.
- Every new table enables RLS in the same migration that creates it. Migrations are named
  `supabase/migrations/<yyyymmddhhmmss>_<name>.sql` and never edited once applied.
- `post_metrics` is append-only. Rates and scores are `numeric`: store 4 dp, display 2 dp, never
  round before summing.
- No `any`, no `TODO`, no stubs that silently return empty data.
- Changes to the data model (specification §4) or the scoring formulas (§5) need sign-off first.
- A new dependency needs a one-line justification in the pull request.

## Conventions

- `PRODUCT_NAME` lives only in `lib/config.ts`; environment variables are parsed there with Zod.
- UI: Tailwind and shadcn/ui, Lucide icons, no emoji, en-GB copy, Europe/London dates.
- Unit tests sit beside the code as `*.test.ts`; integration tests live in `tests/integration/`.
- Comments explain *why*, not *what*.
- Formatting is Prettier (`pnpm format`); `.editorconfig` covers editors without it.
