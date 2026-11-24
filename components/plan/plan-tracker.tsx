import { ArrowUpRight, CheckCircle2, CircleDashed, Clock, TriangleAlert } from "lucide-react";
import { LabelBadge } from "@/components/label-badge";
import { UndoUsedButton } from "@/components/plan/undo-used-button";
import { Badge } from "@/components/ui/badge";
import { FORMAT_LABELS, formatIsoDay, formatScore, formatShortDate } from "@/lib/format";
import type { IdeaOutcome, PlanTracking, Verdict } from "@/lib/services/planTracking";

const VERDICT: Record<Verdict, { title: string; body: string; tone: "good" | "bad" | "neutral" | "info" }> = {
  working: {
    title: "The plan is working",
    body: "Posts made from plan ideas are scoring above this creator's usual and above their other posts.",
    tone: "good",
  },
  mixed: {
    title: "Mixed results so far",
    body: "Plan posts beat one comparison but not the other. Lean on the ideas that scored strong.",
    tone: "neutral",
  },
  not_working: {
    title: "The plan is not working yet",
    body: "Plan posts are scoring below usual and below this creator's other posts. New ideas lean on what did better.",
    tone: "bad",
  },
  too_early: {
    title: "Too early to say",
    body: "Results appear once at least two used ideas have a scored post.",
    tone: "info",
  },
};

function Outcome({ outcome }: { outcome: IdeaOutcome }) {
  switch (outcome.state) {
    case "scored":
    case "scoring": {
      const { post } = outcome;
      return (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 aria-hidden className="size-4 text-foreground/70" />
          <span>Posted {formatShortDate(post.postedAt)}</span>
          {outcome.state === "scored" ? (
            <>
              <span className="font-medium text-foreground">score {formatScore(outcome.post.score)}</span>
              {post.label ? <LabelBadge label={post.label} /> : null}
            </>
          ) : (
            <span>score pending</span>
          )}
          {post.permalink ? (
            <a
              href={post.permalink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
            >
              View post <ArrowUpRight aria-hidden className="size-3" />
            </a>
          ) : null}
        </div>
      );
    }
    case "waiting":
      return (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock aria-hidden className="size-4" /> Waiting for the post (checked until {formatIsoDay(outcome.until)})
        </p>
      );
    case "not_posted":
      return (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleDashed aria-hidden className="size-4" /> No matching post was found
        </p>
      );
  }
}

/** "Is the plan working?": used ideas, the post each became, and how it scored (D-047). */
export function PlanTracker({ tracking, currentWeek }: { tracking: PlanTracking; currentWeek: string[] }) {
  const v = VERDICT[tracking.verdict];
  const week = new Set(currentWeek);
  return (
    <section id="tracker" aria-labelledby="tracker-heading" className="flex scroll-mt-20 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="tracker-heading" className="font-display text-xl font-medium tracking-tight">
          Is the plan working?
        </h2>
        <p className="text-sm text-muted-foreground">
          Ideas you mark as used leave their day, are remembered so they are never suggested again, and are matched
          here to the post you made.
        </p>
      </div>

      {tracking.usedCount === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Mark an idea as used once you post it, and its results will show here.
        </p>
      ) : (
        <>
          <div className="grid gap-3 rounded-xl border border-border/70 bg-card p-5 shadow-card sm:grid-cols-[1.4fr_repeat(3,1fr)]">
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1.5">
                {tracking.verdict === "not_working" ? <TriangleAlert aria-hidden className="size-4" /> : null}
                <Badge tone={v.tone}>{v.title}</Badge>
              </span>
              <p className="text-sm text-muted-foreground">{v.body}</p>
            </div>
            <Stat label="Ideas used" value={String(tracking.usedCount)} hint={`${tracking.postedCount} posted`} />
            <Stat
              label="Plan posts, average score"
              value={tracking.planAverage === null ? "–" : formatScore(tracking.planAverage)}
              hint="1.00 is this creator's usual"
            />
            <Stat
              label="Other posts, average score"
              value={tracking.otherAverage === null ? "–" : formatScore(tracking.otherAverage)}
              hint={`${tracking.strongCount} strong, ${tracking.weakCount} weak from the plan`}
            />
          </div>

          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border/70 bg-card shadow-card">
            {tracking.ideas.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3" data-testid="tracked-idea">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge>{FORMAT_LABELS[i.format] ?? i.format}</Badge>
                    {i.suggestedDate ? <span>Planned for {formatIsoDay(i.suggestedDate)}</span> : null}
                  </div>
                  <p className="text-sm font-medium">{i.title}</p>
                  <Outcome outcome={i.outcome} />
                </div>
                {i.suggestedDate && week.has(i.suggestedDate) ? <UndoUsedButton suggestionId={i.id} /> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-display text-2xl font-medium tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}
