import { Eye, Gauge, ImageIcon, Users } from "lucide-react";
import { toDelta } from "@/components/charts/stat-delta";
import { StatGroup, StatTile } from "@/components/charts/stat-tile";
import { formatCompact, formatNumber, formatScore } from "@/lib/format";
import { compareValues, type AccountAnalytics } from "@/lib/services/analytics";
import type { RangeCopy } from "./range-copy";

/** Headline figures for the selected period, each against the period before it. */
export function SummaryTiles({ analytics: a, range }: { analytics: AccountAnalytics; range: RangeCopy }) {
  const { current, previous } = a;
  return (
    <StatGroup label={`Summary, ${range.text}`}>
      <StatTile
        label="Reach"
        icon={Eye}
        value={formatCompact(current.totalReach)}
        delta={toDelta(compareValues(current.totalReach, previous.totalReach), "relative")}
        comparison={range.comparison}
      />
      <StatTile
        label="Average score"
        icon={Gauge}
        value={current.averageScore === null ? "–" : formatScore(current.averageScore)}
        delta={toDelta(compareValues(current.averageScore, previous.averageScore), "score")}
        comparison={range.comparison}
      />
      <StatTile
        label="Posts published"
        icon={ImageIcon}
        value={formatNumber(current.posts)}
        delta={toDelta(compareValues(current.posts, previous.posts), "relative")}
        comparison={range.comparison}
      />
      <StatTile
        label="Typical reach per post"
        icon={Users}
        value={current.medianReach === null ? "–" : formatCompact(current.medianReach)}
        delta={toDelta(compareValues(current.medianReach, previous.medianReach), "relative")}
        comparison={range.comparison}
      />
    </StatGroup>
  );
}
