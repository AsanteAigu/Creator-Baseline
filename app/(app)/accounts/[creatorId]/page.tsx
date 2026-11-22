import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountBanners } from "@/components/account/account-banners";
import { ReachAndOutcomes, ScoreBreakdowns } from "@/components/account/analytics-cards";
import { AudienceThemesCard } from "@/components/account/audience-themes-card";
import { DisconnectSection } from "@/components/account/disconnect-section";
import { PlanCallout } from "@/components/account/plan-callout";
import { PostListCard } from "@/components/account/post-list-card";
import { rangeCopy } from "@/components/account/range-copy";
import { ReportCard } from "@/components/account/report-card";
import { RunNowButton } from "@/components/account/run-now-button";
import { ScoreTrendCard } from "@/components/account/score-trend-card";
import { SummaryTiles } from "@/components/account/summary-tiles";
import { Banner } from "@/components/banner";
import { CreatorAvatar } from "@/components/creator-avatar";
import { PageHeader } from "@/components/page-header";
import { RangeTabs } from "@/components/range-tabs";
import { buttonVariants } from "@/components/ui/button";
import { requirePageUser, withPageErrors } from "@/app/(app)/page-helpers";
import { uuidParam } from "@/lib/http";
import { formatDateTime } from "@/lib/format";
import { ANALYTICS_RANGES, parseRange } from "@/lib/services/analytics";
import { getOverview } from "@/lib/services/creatorService";
import { getSettings } from "@/lib/services/settingsService";

export const metadata = { title: "Account" };

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ creatorId: string }>;
  searchParams: Promise<{ connected?: string; range?: string }>;
}) {
  const { creatorId } = await params;
  if (!uuidParam.safeParse(creatorId).success) notFound();
  const userId = await requirePageUser();
  const query = await searchParams;
  const result = await withPageErrors(async () => ({
    overview: await getOverview(userId, creatorId, new Date(), parseRange(query.range)),
    settings: (await getSettings(userId)).settings,
  }));
  if ("message" in result) return <Banner tone="warn" title={result.message} />;

  const { overview: o, settings } = result;
  const a = o.analytics;
  const canRun = o.role === "owner" || o.role === "admin";
  const name = o.creator.displayName ?? o.creator.username;
  const range = rangeCopy(a.days);

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

      <AccountBanners
        overview={o}
        canRun={canRun}
        justConnected={query.connected === "1"}
        minAgeHours={settings.minAgeHours}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {o.rangeIsAuto
            ? `Nothing was posted recently, so this shows the ${range.text}.`
            : `Figures for the ${range.text}.`}
        </p>
        <RangeTabs
          options={ANALYTICS_RANGES.map((d) => ({ value: d, label: rangeCopy(d).tab }))}
          current={a.days}
          hrefFor={(d) => `/accounts/${o.creator.id}?range=${d}`}
        />
      </div>

      <SummaryTiles analytics={a} range={range} />
      <ScoreTrendCard
        overview={o}
        strongCutoff={settings.strongCutoff}
        weakCutoff={settings.weakCutoff}
        minAgeHours={settings.minAgeHours}
      />
      <ReachAndOutcomes analytics={a} range={range} />
      <ScoreBreakdowns analytics={a} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PostListCard
          title="Top posts"
          description={`Highest scores in the ${range.text}.`}
          empty={`Nothing scored in the ${range.text}.`}
          posts={o.top}
          emphasis="max"
        />
        <PostListCard
          title="Bottom posts"
          description={`Lowest scores in the ${range.text}.`}
          empty={`Nothing scored in the ${range.text}.`}
          posts={o.bottom}
          emphasis="min"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard report={o.report} isCurrent={o.reportIsCurrent} canRun={canRun} />
        <AudienceThemesCard insight={o.insight} />
      </div>

      <PlanCallout creatorId={o.creator.id} name={name} />
      {canRun ? <DisconnectSection creatorId={o.creator.id} name={name} /> : null}
    </>
  );
}
