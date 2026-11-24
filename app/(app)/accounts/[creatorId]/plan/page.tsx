import { notFound } from "next/navigation";
import { AiDisclaimer } from "@/components/ai-disclaimer";
import { Banner } from "@/components/banner";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PlanTracker } from "@/components/plan/plan-tracker";
import { RegeneratePlanButton } from "@/components/plan/regenerate-plan-button";
import { SuggestionToggle } from "@/components/plan/suggestion-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageUser, withPageErrors } from "@/app/(app)/page-helpers";
import { FORMAT_LABELS, formatIsoDay } from "@/lib/format";
import { uuidParam } from "@/lib/http";
import { getOverview } from "@/lib/services/creatorService";
import { getCurrentPlan, getPlanProgress, type ReplacementNote } from "@/lib/services/planService";
import { weekDates, weekStartLondon } from "@/lib/services/time";

export const metadata = { title: "Content plan" };

/** Shown after an idea is marked used. Fixed codes, so the URL can never inject text. */
const NOTICES: Record<ReplacementNote | "replaced", { tone: "info" | "warn"; title: string }> = {
  replaced: { tone: "info", title: "Marked as used. It is remembered, and a new idea now takes its day." },
  day_passed: { tone: "info", title: "Marked as used. That day has passed, so no new idea was written for it." },
  budget: { tone: "warn", title: "Marked as used. No new idea was written: the monthly AI budget is reached." },
  ai_failed: { tone: "warn", title: "Marked as used, but a new idea couldn't be written. Use Refresh ideas to try again." },
  rate_limited: { tone: "warn", title: "Marked as used. New ideas are paused for a few minutes; use Refresh ideas later." },
};

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ creatorId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { creatorId } = await params;
  const { notice: noticeKey } = await searchParams;
  const notice = noticeKey && noticeKey in NOTICES ? NOTICES[noticeKey as keyof typeof NOTICES] : null;
  if (!uuidParam.safeParse(creatorId).success) notFound();
  const userId = await requirePageUser();
  const result = await withPageErrors(async () => ({
    overview: await getOverview(userId, creatorId),
    plan: await getCurrentPlan(userId, creatorId),
    progress: await getPlanProgress(userId, creatorId),
  }));
  if ("message" in result) return <Banner tone="warn" title={result.message} />;
  const { overview: o, plan, progress } = result;
  const name = o.creator.displayName ?? o.creator.username;
  const canRegenerate = o.role === "owner" || o.role === "admin";
  const days = weekDates(plan?.weekStart ?? weekStartLondon(new Date()));
  // Used ideas have left their day for the tracker below (D-047).
  const active = plan?.suggestions.filter((s) => s.status !== "used") ?? [];
  const usedThisWeek = (plan?.suggestions.length ?? 0) - active.length;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Overview", href: "/dashboard" },
          { label: name, href: `/accounts/${o.creator.id}` },
          { label: "Plan" },
        ]}
        eyebrow={`@${o.creator.username} · week of ${formatIsoDay(days[0] ?? "")}`}
        title="This week's plan"
        description={plan ? `${active.length} ideas planned, ${usedThisWeek} used this week` : undefined}
        actions={
          canRegenerate ? (
            <RegeneratePlanButton creatorId={o.creator.id} label={plan ? "Refresh ideas" : "Create plan"} />
          ) : undefined
        }
      />

      {notice ? <Banner tone={notice.tone} title={notice.title} /> : null}

      {o.aiNote?.code === "AI_BUDGET" ? (
        <Banner tone="info" title="AI summaries paused — monthly budget reached.">
          New ideas will appear when the budget resets or is raised.
        </Banner>
      ) : null}

      {!plan ? (
        <EmptyState title="No plan for this week yet.">
          {canRegenerate
            ? "Create one now, or it will be written after the next update."
            : "It will be written after the next update."}
        </EmptyState>
      ) : (
        <>
          <section className="surface-gradient flex flex-col gap-3 rounded-xl border border-white/60 p-6 shadow-card sm:p-7">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-foreground/60">
              This week&apos;s focus
            </p>
            <p className="max-w-3xl font-display text-lg leading-snug tracking-tight sm:text-xl">{plan.summary}</p>
            {progress.profile.guidance.length > 0 ? (
              <div className="flex flex-col gap-1.5 border-t border-foreground/10 pt-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-foreground/60">
                  Built from this account&apos;s scores
                </p>
                <ul className="flex flex-col gap-1 text-sm text-foreground/80">
                  {progress.profile.guidance.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <AiDisclaimer />
          </section>

          <ol
            className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-7 sm:gap-3 sm:px-0"
            aria-label="Week at a glance"
          >
            {days.map((day) => {
              const ideas = active.filter((s) => s.suggestedDate === day);
              return (
                <li
                  key={day}
                  className={
                    ideas.length > 0
                      ? "min-w-[132px] snap-start rounded-xl border border-border/70 bg-card p-3 shadow-card sm:min-w-0"
                      : "min-w-[132px] snap-start rounded-xl border border-dashed border-border bg-transparent p-3 sm:min-w-0"
                  }
                >
                  <p className="text-xs font-medium text-muted-foreground">{formatIsoDay(day)}</p>
                  {ideas.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">Nothing planned</p>
                  ) : (
                    ideas.map((s) => (
                      <a
                        key={s.id}
                        href={`#idea-${s.id}`}
                        className="mt-2 block rounded-md bg-muted px-2 py-1.5 text-xs font-medium leading-snug hover:bg-primary hover:text-primary-foreground"
                      >
                        {s.title}
                      </a>
                    ))
                  )}
                </li>
              );
            })}
          </ol>

          <ul className="grid gap-4 sm:grid-cols-2">
            {active.map((s) => (
              <li key={s.id} id={`idea-${s.id}`} className="scroll-mt-20">
                <Card className="flex h-full flex-col" data-testid="suggestion-card">
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge>{FORMAT_LABELS[s.format] ?? s.format}</Badge>
                      {s.suggestedDate ? <span>{formatIsoDay(s.suggestedDate)}</span> : null}
                    </div>
                    <CardTitle>{s.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    {s.hook ? (
                      <p className="border-l-2 border-accent/40 pl-3 text-sm italic text-foreground/85">
                        &ldquo;{s.hook}&rdquo;
                      </p>
                    ) : null}
                    {s.reason ? <p className="text-sm text-muted-foreground">{s.reason}</p> : null}
                    {s.dataRef ? <p className="text-xs text-muted-foreground">Based on: {s.dataRef}</p> : null}
                    <div className="mt-auto">
                      <SuggestionToggle suggestionId={s.id} initial={s.status} />
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <PlanTracker tracking={progress.tracking} currentWeek={days} />
    </>
  );
}
