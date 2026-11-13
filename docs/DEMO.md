# Five-minute demo script

For the client call. The goal is to show the weekly loop they asked for — scores against
their own baseline, what worked, what the audience is talking about, and next week's ideas —
without spending the call explaining infrastructure.

## Before the call (5 minutes, do not skip)

```bash
pnpm install
pnpm db:reset          # fresh schema, three creators, 40 posts each, full pipeline
pnpm dev
```

- [ ] Open <http://localhost:3000/login> and sign in as `owner@demo.agency` /
      `creator-baseline-demo`.
- [ ] Check the dashboard shows three cards, each with a score trend and a last-run time.
- [ ] Open Maya's account page once so fonts and charts are warm.
- [ ] Keep a second tab on `/api/health`.
- [ ] Close Slack, silence notifications, share only the browser window.

If the network or database is unavailable, say so and use the screenshots in
`docs/screenshots/` (if present) rather than improvising. Do not reseed during the call.

## The script

### 0:00 — The problem, in one sentence

> "You produce the posts; the numbers arrive in a dashboard that does not tell you what was
> actually good for *this* creator. We compare every post with that creator's own normal
> results, so 'good' means good for them, not good compared with someone else."

### 0:30 — Dashboard

Show `/dashboard`.

- Three cards: avatar, recent score trend, last update time, and a badge when something
  needs attention.
- Point out the **Connect account** button (owners and admins only) and the "needs
  reconnecting" state. "If Instagram ever withdraws access, we say so here and give you a
  reconnect button rather than silently showing stale numbers."

### 1:00 — One creator's account page

Click **Maya Okafor**.

- **Score trend:** each dot is a post. Colour is always paired with a label (Strong, Normal,
  Weak, Too early, Baseline building), so it works for colour-blind viewers.
- **Top posts / bottom posts:** the last four weeks, with reach and the score.
- **What's working / what isn't:** the written summary, with the standing disclaimer
  "AI-generated advice. Review before you act on it."
- **Audience themes:** positive/neutral/negative split and paraphrased themes. "We read
  recent comments in memory; we store counts and paraphrases, never the comments themselves."

Say the baseline rule once:

> "A new creator gets no score until each format has five posts. A post under 24 hours old is
> marked Too early, because its numbers are still moving. We never invent a score."

### 2:30 — This week's plan

Click **This week's plan**.

- Seven idea cards, each with a format, a hook, a reason and the data it references.
- Mark one **Used**. Reload the page. It is still Used.
- "The plan is refreshed in place each week. Your decisions survive the refresh."

### 3:15 — Settings

Open **Settings**.

- Weights per signal, strong/weak cutoffs, the score cap, minimum post age, baseline window,
  run frequency and the monthly AI budget.
- "Changes apply to the next run. Old scores keep the weights they were calculated with, so
  history does not silently change."
- Point at the AI budget: "When the budget is reached, written summaries pause; scores keep
  updating."

### 4:00 — The weekly loop

Explain, without opening the Inngest dashboard:

- Every hour the system checks which creators are due, based on the interval in Settings
  (default six hours).
- The pipeline fetches posts and insights, stores a metrics snapshot, recomputes the
  baseline, scores, reads comments for themes, writes the report, and updates the week's plan.
- Monday at 06:00 London time it regenerates the plan for every active creator.
- A failed Instagram call becomes a readable banner and a retry on the next tick. An AI
  failure never blocks scores.

### 4:30 — Disconnect and deletion

On the account page, scroll to **Disconnect this account**, click it once to show the
confirmation, then **Cancel**. Do not confirm on the call.

> "Disconnect is one path for the UI and the API. It deletes that creator's posts, metrics,
> scores, reports, plans and insights, revokes the token at Meta, and leaves an audit record
> and a deletion record — the records outlive the data on purpose."

### 4:50 — Close

> "What we need from you: the final three handles, confirmation of the report cadence, and
> whether anyone outside the agency should see a subset of creators. The three accounts in
> this demo are fixtures; connecting a real account is the Connect button plus a Facebook
> login."

## Questions to expect

| Question | Answer |
|---|---|
| "Is this live Instagram data?" | "In this demo, no — it is deterministic fixture data going through the real pipeline. The Graph adapter is built and behind `INSTAGRAM_SOURCE=graph`; it needs the Meta app approval and the three accounts' login." |
| "Why is a post missing a score?" | "Under 24 hours old, or its format does not yet have five posts for a baseline. The page says which." |
| "What if Instagram is down?" | "The run is marked failed with a time and the next retry; the rest of the page still renders from the last success." |
| "Can we add a fourth creator?" | "Not in v1: the scope is three accounts. The data model is not limited to three, but the product decisions are." |
| "Where does our data live?" | "Supabase Postgres in the EU region you choose, row-level security per workspace, tokens encrypted at rest. Comments are not stored." |
| "What does it cost to run?" | "Anthropic usage per creator per run, visible against the monthly budget in Settings; the rest is hosting." |

## If something breaks

- **Blank page / 500:** check the terminal for the error class; check `/api/health` signed in.
- **No scores:** confirm `pnpm db:reset` finished and the ingest step printed three
  `"status":"succeeded"` lines.
- **Sign-in fails:** reseed with `SEED_DEMO_PASSWORD` set, or use the local default.
- **Never** debug SQL, tokens or environment values on a shared screen.
