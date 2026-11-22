import { ArrowUpRight, CalendarDays, Check, Eye, Gauge, ImageIcon, KeyRound, Users, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AiDisclaimer } from "@/components/ai-disclaimer";
import { Banner } from "@/components/banner";
import { CreatorAvatar } from "@/components/creator-avatar";
import { DisconnectButton } from "@/components/disconnect-button";
import { EmptyState } from "@/components/empty-state";
import { LabelBadge } from "@/components/label-badge";
import { PostRow } from "@/components/post-row";
import { RunNowButton } from "@/components/run-now-button";
import { ColumnChart } from "@/components/charts/column-chart";
import { LabelMixBar } from "@/components/charts/label-mix-bar";
import { StatGroup, StatTile } from "@/components/charts/stat-tile";
import { ScoreTrendChart } from "@/components/score-trend-chart";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requirePageUser, withPageErrors } from "@/app/(app)/page-helpers";
import { toDelta } from "@/app/(app)/stat-helpers";
import { uuidParam } from "@/lib/http";
import {
  FORMAT_LABELS,
  FORMAT_PLURAL,
  formatCompact,
  formatDate,
  formatDateTime,
  formatIsoDay,
  formatIsoShortDate,
  formatNumber,
  formatPercent,
  formatScore,
  formatShortDate,
} from "@/lib/format";
import { compareValues } from "@/lib/services/analytics";
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
  const a = o.analytics;
  const canRun = o.role === "owner" || o.role === "admin";
  const name = o.creator.displayName ?? o.creator.username;
  const justConnected = (await searchParams).connected === "1";

  const sentimentTotal = o.insight ? o.insight.positive + o.insight.neutral + o.insight.negative : 0;
  const scoredCount = o.labelCounts.strong + o.labelCounts.normal + o.labelCounts.weak;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Overview", href: "/dashboard" }, { label: name }]}
        leading={<CreatorAvatar name={name} className="size-16 text-lg" />}
        eyebrow={`@${o.creator.username}`}
        title={name}
        description={
          <>
            {o.creator.lastSyncedAt ? `Updated ${formatDateTime(o.creator.lastSyncedAt)}` : "Not updated yet"}
            {o.nextUpdateAt ? ` · Next update around ${formatDateTime(o.nextUpdateAt)}` : ""}
          </>
        }
        actions={
          <>
            {canRun ? <RunNowButton creatorId={o.creator.id} /> : null}
            <Link href={`/accounts/${o.creator.id}/plan`} className={buttonVariants({ variant: "default" })}>
              <CalendarDays aria-hidden />
              This week&apos;s plan
            </Link>
          </>
        }
      />

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

      <StatGroup label="Last 28 days">
        <StatTile
          label="Reach"
          icon={Eye}
          value={formatCompact(a.current.totalReach)}
          delta={toDelta(compareValues(a.current.totalReach, a.previous.totalReach), "relative")}
        />
        <StatTile
          label="Average score"
          icon={Gauge}
          value={a.current.averageScore === null ? "–" : formatScore(a.current.averageScore)}
          delta={toDelta(compareValues(a.current.averageScore, a.previous.averageScore), "score")}
        />
        <StatTile
          label="Posts published"
          icon={ImageIcon}
          value={formatNumber(a.current.posts)}
          delta={toDelta(compareValues(a.current.posts, a.previous.posts), "relative")}
        />
        <StatTile
          label="Typical reach per post"
          icon={Users}
          value={a.current.medianReach === null ? "–" : formatCompact(a.current.medianReach)}
          delta={toDelta(compareValues(a.current.medianReach, a.previous.medianReach), "relative")}
        />
      </StatGroup>

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

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Weekly reach</CardTitle>
            <CardDescription>Accounts reached by the posts published each week, last 12 weeks.</CardDescription>
          </CardHeader>
          <CardContent>
            <ColumnChart
              ariaLabel="Weekly reach for the last 12 weeks."
              valueFormat="compact"
              groupHeading="Week starting"
              valueHeading="Reach"
              data={a.weeklyReach.map((w) => ({
                key: w.weekStart,
                label: formatIsoShortDate(w.weekStart),
                value: w.posts === 0 ? null : w.reach,
                valueText: w.posts === 0 ? "No posts" : formatCompact(w.reach),
                details: [`Week of ${formatIsoDay(w.weekStart)}`, `${w.posts} post${w.posts === 1 ? "" : "s"}`],
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Post outcomes</CardTitle>
            <CardDescription>How the last 28 days&apos; scored posts compare with this creator&apos;s usual.</CardDescription>
          </CardHeader>
          <CardContent>
            <LabelMixBar counts={a.labelMix} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Score by format</CardTitle>
            <CardDescription>Average score per format, last 90 days.</CardDescription>
          </CardHeader>
          <CardContent>
            {a.byFormat.length > 0 ? (
              <ColumnChart
                ariaLabel="Average score by post format over the last 90 days."
                valueFormat="score"
                groupHeading="Format"
                valueHeading="Average score"
                reference={{ value: 1, label: "1.00 is this creator's usual post" }}
                data={a.byFormat.map((g) => ({
                  key: g.key,
                  label: FORMAT_LABELS[g.key] ?? g.key,
                  value: g.averageScore,
                  valueText: g.averageScore !== null ? formatScore(g.averageScore) : g.posts > 0 ? "Not scored yet" : "No posts",
                  details: [
                    `${g.scored} scored of ${g.posts} post${g.posts === 1 ? "" : "s"}`,
                    g.medianReach === null ? "No reach data" : `Typical reach ${formatCompact(g.medianReach)}`,
                  ],
                }))}
              />
            ) : (
              <EmptyState title="No posts in the last 90 days." />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Score by day posted</CardTitle>
            <CardDescription>Average score by the London weekday a post went out, last 90 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <ColumnChart
              ariaLabel="Average score by weekday posted over the last 90 days."
              valueFormat="score"
              groupHeading="Day"
              valueHeading="Average score"
              reference={{ value: 1, label: "1.00 is this creator's usual post" }}
              data={a.byWeekday.map((g) => ({
                key: g.key,
                label: g.key,
                value: g.averageScore,
                valueText: g.averageScore !== null ? formatScore(g.averageScore) : g.posts > 0 ? "Not scored yet" : "No posts",
                details: [`${g.scored} scored of ${g.posts} post${g.posts === 1 ? "" : "s"}`],
              }))}
            />
          </CardContent>
        </Card>
      </div>

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
                <p className="font-display text-lg font-medium leading-snug tracking-tight">{o.report.headline}</p>
                <ReportList title="Working" tone="good" items={o.report.whatWorking} />
                <ReportList title="Not working" tone="bad" items={o.report.whatNotWorking} />
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
                  <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
                    <div className="bg-good" style={{ width: `${(o.insight.positive / sentimentTotal) * 100}%` }} />
                    <div className="bg-[var(--status-neutral)]" style={{ width: `${(o.insight.neutral / sentimentTotal) * 100}%` }} />
                    <div className="bg-critical" style={{ width: `${(o.insight.negative / sentimentTotal) * 100}%` }} />
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
                    <li key={t.label} className="py-3 first:pt-0">
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
        className="surface-gradient group flex items-center justify-between gap-4 rounded-xl border border-white/60 p-6 shadow-card transition-shadow hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:p-8"
      >
        <span className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-2 text-xs font-medium text-foreground/70">
            <CalendarDays aria-hidden className="size-4" /> Content plan
          </span>
          <span className="font-display text-xl font-medium tracking-tight sm:text-2xl">See this week&apos;s content plan</span>
          <span className="text-sm text-foreground/70">Ideas drafted from what is working for {name}.</span>
        </span>
        <span
          aria-hidden
          className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-card text-foreground shadow-card transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
        >
          <ArrowUpRight className="size-5" />
        </span>
      </Link>

      {canRun ? (
        <section className="flex flex-col gap-4 rounded-xl border border-[#d03b3b]/20 bg-card p-5 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="max-w-2xl">
            <h2 className="font-display text-[17px] font-medium tracking-tight">Disconnect this account</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Deletes this creator&apos;s posts, metrics, scores, reports and plans, and revokes the access token at
              Meta. Past figures cannot be recovered.
            </p>
          </div>
          <DisconnectButton creatorId={o.creator.id} name={name} />
        </section>
      ) : null}
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

function ReportList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "good" | "bad";
  items: { point: string; evidence: string }[];
}) {
  const Icon = tone === "good" ? Check : X;
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      <ul className="mt-2 flex flex-col gap-3 text-sm">
        {items.map((item) => (
          <li key={item.point} className="flex gap-3">
            <span
              aria-hidden
              className={
                tone === "good"
                  ? "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#0ca30c]/10 text-good-text"
                  : "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#d03b3b]/10 text-critical-text"
              }
            >
              <Icon className="size-3" />
            </span>
            <span>
              {item.point}
              <span className="mt-0.5 block text-muted-foreground">{item.evidence}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
