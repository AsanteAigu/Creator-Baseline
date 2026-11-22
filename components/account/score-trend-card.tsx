import { ScoreTrendChart } from "@/components/charts/score-trend-chart";
import { EmptyState } from "@/components/empty-state";
import { LabelBadge } from "@/components/label-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FORMAT_PLURAL, formatShortDate } from "@/lib/format";
import type { CreatorOverview } from "@/lib/services/creatorService";

export function ScoreTrendCard({
  overview: o,
  strongCutoff,
  weakCutoff,
  minAgeHours,
}: {
  overview: CreatorOverview;
  strongCutoff: number;
  weakCutoff: number;
  minAgeHours: number;
}) {
  const { strong, normal, weak, too_early: tooEarly } = o.labelCounts;
  const scored = strong + normal + weak;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Score trend</CardTitle>
        <CardDescription>
          Each post compared with this creator&apos;s usual results for the same format.
          {scored > 0 ? ` ${strong} strong, ${normal} normal, ${weak} weak.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {o.trend.length >= 2 ? (
          <ScoreTrendChart
            strongCutoff={strongCutoff}
            weakCutoff={weakCutoff}
            data={o.trend.map((p) => ({
              postId: p.postId,
              dateLabel: formatShortDate(p.postedAt),
              format: p.format,
              score: p.score,
              label: p.label,
            }))}
          />
        ) : (
          <EmptyState title="No scores yet.">
            Scores appear after the first update, once posts are at least a day old.
          </EmptyState>
        )}
        <div className="mt-3 flex flex-col gap-2">
          {tooEarly > 0 ? (
            <p className="text-sm text-muted-foreground">
              <LabelBadge label="too_early" /> {tooEarly} post{tooEarly === 1 ? " is" : "s are"} under {minAgeHours}{" "}
              hours old and will be scored once {tooEarly === 1 ? "it has" : "they have"} had time to settle.
            </p>
          ) : null}
          {o.baselineGaps.map((g) => (
            <p key={g.format} className="text-sm text-muted-foreground">
              <LabelBadge label="baseline_building" /> This creator needs {g.need} more{" "}
              {FORMAT_PLURAL[g.format] ?? g.format} before we can set a baseline for them.
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
