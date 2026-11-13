import Link from "next/link";
import { notFound } from "next/navigation";
import { AiDisclaimer } from "@/components/ai-disclaimer";
import { Banner } from "@/components/banner";
import { EmptyState } from "@/components/empty-state";
import { RegeneratePlanButton } from "@/components/regenerate-plan-button";
import { SuggestionToggle } from "@/components/suggestion-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageUser, withPageErrors } from "@/app/(app)/page-helpers";
import { FORMAT_LABELS, formatIsoDay } from "@/lib/format";
import { uuidParam } from "@/lib/http";
import { getOverview } from "@/lib/services/creatorService";
import { getCurrentPlan } from "@/lib/services/planService";
import { weekDates, weekStartLondon } from "@/lib/services/time";

export const metadata = { title: "Content plan" };

export default async function PlanPage({ params }: { params: Promise<{ creatorId: string }> }) {
  const { creatorId } = await params;
  if (!uuidParam.safeParse(creatorId).success) notFound();
  const userId = await requirePageUser();
  const result = await withPageErrors(async () => ({
    overview: await getOverview(userId, creatorId),
    plan: await getCurrentPlan(userId, creatorId),
  }));
  if ("message" in result) return <Banner tone="warn" title={result.message} />;
  const { overview: o, plan } = result;
  const name = o.creator.displayName ?? o.creator.username;
  const canRegenerate = o.role === "owner" || o.role === "admin";
  const days = weekDates(plan?.weekStart ?? weekStartLondon(new Date()));
  const decided = plan?.suggestions.filter((s) => s.status !== "proposed").length ?? 0;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/dashboard" className="hover:underline">
          Accounts
        </Link>{" "}
        /{" "}
        <Link href={`/accounts/${o.creator.id}`} className="hover:underline">
          {name}
        </Link>{" "}
        / Plan
      </nav>

      <section className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">This week&apos;s plan</h1>
          <p className="text-sm text-muted-foreground">
            @{o.creator.username} · week of {formatIsoDay(days[0] ?? "")}
            {plan ? ` · ${decided} of ${plan.suggestions.length} marked` : ""}
          </p>
        </div>
        {canRegenerate ? (
          <RegeneratePlanButton creatorId={o.creator.id} label={plan ? "Refresh ideas" : "Create plan"} />
        ) : null}
      </section>

      {o.aiNote?.code === "AI_BUDGET" ? (
        <Banner tone="info" title="AI summaries paused — monthly budget reached.">
          New ideas will appear when the budget resets or is raised.
        </Banner>
      ) : null}

      {!plan ? (
        <EmptyState title="No plan for this week yet.">
          {canRegenerate ? "Create one now, or it will be written after the next update." : "It will be written after the next update."}
        </EmptyState>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-4 sm:pt-5">
              <p className="text-sm">{plan.summary}</p>
              <AiDisclaimer />
            </CardContent>
          </Card>

          <ol
            className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-7 sm:px-0"
            aria-label="Week at a glance"
          >
            {days.map((day) => {
              const ideas = plan.suggestions.filter((s) => s.suggestedDate === day);
              return (
                <li key={day} className="min-w-[132px] snap-start rounded-lg border border-border bg-card p-2 sm:min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{formatIsoDay(day)}</p>
                  {ideas.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">Nothing planned</p>
                  ) : (
                    ideas.map((s) => (
                      <a key={s.id} href={`#idea-${s.id}`} className="mt-1 block text-xs font-medium leading-snug hover:underline">
                        {s.title}
                      </a>
                    ))
                  )}
                </li>
              );
            })}
          </ol>

          <ul className="grid gap-3 sm:grid-cols-2">
            {plan.suggestions.map((s) => (
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
                    {s.hook ? <p className="text-sm">&ldquo;{s.hook}&rdquo;</p> : null}
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
    </>
  );
}
