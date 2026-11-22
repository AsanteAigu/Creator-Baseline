import { ColumnChart } from "@/components/charts/column-chart";
import { LabelMixBar } from "@/components/charts/label-mix-bar";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FORMAT_LABELS, formatCompact, formatIsoDay, formatIsoShortDate, formatScore } from "@/lib/format";
import type { AccountAnalytics, GroupSummary } from "@/lib/services/analytics";
import { breakdownText, type RangeCopy } from "./range-copy";

const USUAL_POST = { value: 1, label: "1.00 is this creator's usual post" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function scoreText(g: GroupSummary): string {
  if (g.averageScore !== null) return formatScore(g.averageScore);
  return g.posts > 0 ? "Not scored yet" : "No posts";
}

/** Weekly reach beside the mix of strong, normal and weak posts. */
export function ReachAndOutcomes({ analytics: a, range }: { analytics: AccountAnalytics; range: RangeCopy }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Weekly reach</CardTitle>
          <CardDescription>Accounts reached by the posts published each week, last {a.weeks} weeks.</CardDescription>
        </CardHeader>
        <CardContent>
          <ColumnChart
            ariaLabel={`Weekly reach for the last ${a.weeks} weeks.`}
            valueFormat="compact"
            groupHeading="Week starting"
            valueHeading="Reach"
            data={a.weeklyReach.map((w) => ({
              key: w.weekStart,
              label: formatIsoShortDate(w.weekStart),
              value: w.posts === 0 ? null : w.reach,
              valueText: w.posts === 0 ? "No posts" : formatCompact(w.reach),
              details: [`Week of ${formatIsoDay(w.weekStart)}`, plural(w.posts, "post")],
            }))}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Post outcomes</CardTitle>
          <CardDescription>
            How scored posts from the {range.text} compare with this creator&apos;s usual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LabelMixBar counts={a.labelMix} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Average score by format and by weekday posted, over the longer breakdown window. */
export function ScoreBreakdowns({ analytics: a }: { analytics: AccountAnalytics }) {
  const window = breakdownText(a.breakdownDays);
  const weekdayHasPosts = a.byWeekday.some((g) => g.posts > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Score by format</CardTitle>
          <CardDescription>Average score per format, {window}.</CardDescription>
        </CardHeader>
        <CardContent>
          {a.byFormat.length > 0 ? (
            <ColumnChart
              ariaLabel={`Average score by post format over the ${window}.`}
              valueFormat="score"
              groupHeading="Format"
              valueHeading="Average score"
              reference={USUAL_POST}
              data={a.byFormat.map((g) => ({
                key: g.key,
                label: FORMAT_LABELS[g.key] ?? g.key,
                value: g.averageScore,
                valueText: scoreText(g),
                details: [
                  `${g.scored} scored of ${plural(g.posts, "post")}`,
                  g.medianReach === null ? "No reach data" : `Typical reach ${formatCompact(g.medianReach)}`,
                ],
              }))}
            />
          ) : (
            <EmptyState title={`No posts in the ${window}.`} />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Score by day posted</CardTitle>
          <CardDescription>Average score by the London weekday a post went out, {window}.</CardDescription>
        </CardHeader>
        <CardContent>
          {weekdayHasPosts ? (
            <ColumnChart
              ariaLabel={`Average score by weekday posted over the ${window}.`}
              valueFormat="score"
              groupHeading="Day"
              valueHeading="Average score"
              reference={USUAL_POST}
              data={a.byWeekday.map((g) => ({
                key: g.key,
                label: g.key,
                value: g.averageScore,
                valueText: scoreText(g),
                details: [`${g.scored} scored of ${plural(g.posts, "post")}`],
              }))}
            />
          ) : (
            <EmptyState title={`No posts in the ${window}.`} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
