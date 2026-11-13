import { CalendarDays, ChevronRight, KeyRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AiDisclaimer } from "@/components/ai-disclaimer";
import { Banner } from "@/components/banner";
import { CreatorAvatar } from "@/components/creator-avatar";
import { EmptyState } from "@/components/empty-state";
import { LabelBadge } from "@/components/label-badge";
import { PostRow } from "@/components/post-row";
import { RunNowButton } from "@/components/run-now-button";
import { ScoreTrendChart } from "@/components/score-trend-chart";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageUser, withPageErrors } from "@/app/(app)/page-helpers";
import { uuidParam } from "@/lib/http";
import { FORMAT_PLURAL, formatDate, formatDateTime, formatPercent, formatShortDate } from "@/lib/format";
import type { Label } from "@/lib/scoring";
import { getOverview } from "@/lib/services/creatorService";
import { getSettings } from "@/lib/services/settingsService";

export const metadata = { title: "Account" };

const SENTIMENT_TEXT = { positive: "Positive", neutral: "Neutral", negative: "Negative" } as const;

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ creatorId: string }>;
  searchParams: Promise<{ connected?: string }>;
}) {
  const { creatorId } = await params;
  if (!uuidParam.safeParse(creatorId).success) notFound();
  const userId = await requirePageUser();
  const result = await withPageErrors(async () => ({
    overview: await getOverview(userId, creatorId),
    settings: (await getSettings(userId)).settings,
  }));
  if ("message" in result) return <Banner tone="warn" title={result.message} />;
  const { overview: o, settings } = result;
  const canRun = o.role === "owner" || o.role === "admin";
  const name = o.creator.displayName ?? o.creator.username;
  const justConnected = (await searchParams).connected === "1";

  const sentimentTotal = o.insight ? o.insight.positive + o.insight.neutral + o.insight.negative : 0;
  const scoredCount = o.labelCounts.strong + o.labelCounts.normal + o.labelCounts.weak;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/dashboard" className="hover:underline">
          Accounts
        </Link>{" "}
        / {name}
      </nav>

      <section className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-3">
          <CreatorAvatar name={name} className="size-12" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{name}</h1>
            <p className="text-sm text-muted-foreground">
              @{o.creator.username}
              {o.creator.lastSyncedAt ? ` · Updated ${formatDateTime(o.creator.lastSyncedAt)}` : " · Not updated yet"}
              {o.nextUpdateAt ? ` · Next update around ${formatDateTime(o.nextUpdateAt)}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/accounts/${o.creator.id}/plan`} className={buttonVariants({ variant: "default" })}>
            <CalendarDays aria-hidden />
            This week&apos;s plan
          </Link>
          {canRun ? <RunNowButton creatorId={o.creator.id} /> : null}
        </div>
      </section>

      {justConnected ? (
        <Banner tone="info" title="Account connected.">
          Use “Update now” to fetch this account&apos;s posts. Scores appear for posts that are at least{" "}
          {settings.minAgeHours} hours old.
        </Banner>
      ) : null}
      {o.creator.status === "needs_reauth" ? (
        <Banner
          tone="warn"
          title="This account needs reconnecting."
          action={
            canRun ? (
              // Full navigation: the route redirects to Facebook.
              <a
                href={`/api/creators/connect?creatorId=${o.creator.id}`}
                className={buttonVariants({ variant: "outline" })}
              >
                <KeyRound aria-hidden />
                Reconnect
              </a>
            ) : undefined
          }
        >
          Instagram asked for permission again. Until it is reconnected, the scores below won&apos;t update.
        </Banner>
      ) : null}
      {o.latestRun?.status === "failed" ? (
        <Banner tone="error" title="The latest update didn't finish." action={canRun ? <RunNowButton creatorId={o.creator.id} label="Try again" /> : undefined}>
          {o.latestRun.errorMessage} The scores below are from the last successful update.
        </Banner>
      ) : null}
      {o.aiNote?.code === "AI_BUDGET" ? <Banner tone="info" title="AI summaries paused — monthly budget reached.">Scores are still up to date. An admin can raise the budget in Settings.</Banner> : null}
      {o.aiNote?.code === "AI_FAILED" ? (
        <Banner tone="warn" title="The written summary couldn't be generated this time." action={canRun ? <RunNowButton creatorId={o.creator.id} label="Retry" /> : undefined}>
          Scores are up to date. The summary below may be from an earlier update.
        </Banner>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Score trend</CardTitle>
          <CardDescription>
            Each post compared with this creator&apos;s usual results for the same format.
            {scoredCount > 0 ? ` ${o.labelCounts.strong} strong, ${o.labelCounts.normal} normal, ${o.labelCounts.weak} weak.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {o.trend.length >= 2 ? (
            <ScoreTrendChart
              strongCutoff={settings.strongCutoff}
              weakCutoff={settings.weakCutoff}
              data={o.trend.map((p) => ({
                postId: p.postId,
                dateLabel: formatShortDate(p.postedAt),
                format: p.format,
                score: p.score,
                label: p.label,
              }))}
            />
          ) : (
            <EmptyState title="No scores yet.">Scores appear after the first update, once posts are at least a day old.</EmptyState>
          )}
          <div className="mt-3 flex flex-col gap-2">
            {o.labelCounts.too_early > 0 ? (
              <p className="text-sm text-muted-foreground">
                <LabelBadge label="too_early" /> {o.labelCounts.too_early} post{o.labelCounts.too_early === 1 ? " is" : "s are"} under{" "}
                {settings.minAgeHours} hours old and will be scored once {o.labelCounts.too_early === 1 ? "it has" : "they have"} had time to settle.
              </p>
            ) : null}
            {o.baselineGaps.map((g) => (
              <p key={g.format} className="text-sm text-muted-foreground">
                <LabelBadge label="baseline_building" /> This creator needs {g.need} more {FORMAT_PLURAL[g.format] ?? g.format} before we can
                set a baseline for them.
              </p>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <PostListCard title="Top posts" description="Highest scores in the last four weeks." posts={o.top} emphasis="max" />
        <PostListCard title="Bottom posts" description="Lowest scores in the last four weeks." posts={o.bottom} emphasis="min" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What&apos;s working and what isn&apos;t</CardTitle>
            {o.report ? (
              <CardDescription>
                {formatDate(o.report.periodStart)} to {formatDate(o.report.periodEnd)}
                {!o.reportIsCurrent ? " · from an earlier update" : ""}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {o.report ? (
              <>
                <p className="font-medium">{o.report.headline}</p>
                <ReportList title="Working" items={o.report.whatWorking} />
                <ReportList title="Not working" items={o.report.whatNotWorking} />
                <AiDisclaimer />
              </>
            ) : (
              <EmptyState title="No written summary yet.">
                {canRun ? "Start an update to generate one." : "It will appear after the next update."}
              </EmptyState>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audience themes</CardTitle>
            {o.insight ? (
              <CardDescription>From {o.insight.commentsSampled} recent comments. Comments themselves are never stored.</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {o.insight && sentimentTotal > 0 ? (
              <>
                <div>
                  <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
                    <div className="bg-[#0ca30c]" style={{ width: `${(o.insight.positive / sentimentTotal) * 100}%` }} />
                    <div className="bg-[#b5b5b0]" style={{ width: `${(o.insight.neutral / sentimentTotal) * 100}%` }} />
                    <div className="bg-[#d03b3b]" style={{ width: `${(o.insight.negative / sentimentTotal) * 100}%` }} />
                  </div>
                  <p className="mt-2 text-sm">
                    {(["positive", "neutral", "negative"] as const).map((k, i) => (
                      <span key={k}>
                        {i > 0 ? " · " : ""}
                        {SENTIMENT_TEXT[k]} {formatPercent(o.insight![k] / sentimentTotal)}
                      </span>
                    ))}
                  </p>
                </div>
                <ul className="flex flex-col divide-y divide-border">
                  {o.insight.themes.map((t) => (
                    <li key={t.label} className="py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{t.label}</p>
                        <Badge tone={t.sentiment === "positive" ? "good" : t.sentiment === "negative" ? "bad" : "neutral"}>
                          {SENTIMENT_TEXT[t.sentiment]} · {t.count}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{t.exampleParaphrase}</p>
                    </li>
                  ))}
                </ul>
                <AiDisclaimer />
              </>
            ) : (
              <EmptyState title="No comment themes yet.">Themes appear once recent posts have comments to read.</EmptyState>
            )}
          </CardContent>
        </Card>
      </div>

      <Link
        href={`/accounts/${o.creator.id}/plan`}
        className="flex min-h-11 items-center justify-between rounded-lg border border-border bg-card p-4 hover:bg-muted/40"
      >
        <span className="flex items-center gap-2 font-medium">
          <CalendarDays aria-hidden className="size-4" /> See this week&apos;s content plan
        </span>
        <ChevronRight aria-hidden className="size-4" />
      </Link>

    </>
  );
}

function PostListCard({
  title,
  description,
  posts,
  emphasis,
}: {
  title: string;
  description: string;
  posts: { id: string; format: string; permalink: string | null; postedAt: Date; captionExcerpt: string | null; reach: number | null; score: number | null; label: Label | null; rValues: Record<string, number> }[];
  emphasis: "max" | "min";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {posts.length > 0 ? (
          <ul className="divide-y divide-border">
            {posts.map((p) => (
              <PostRow key={p.id} post={p} emphasis={emphasis} />
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing scored in the last four weeks." />
        )}
      </CardContent>
    </Card>
  );
}

function ReportList({ title, items }: { title: string; items: { point: string; evidence: string }[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-1 flex list-disc flex-col gap-2 pl-5 text-sm">
        {items.map((item) => (
          <li key={item.point}>
            {item.point}
            <span className="block text-muted-foreground">{item.evidence}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
