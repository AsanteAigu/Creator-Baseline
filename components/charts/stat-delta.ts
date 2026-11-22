import type { StatDelta } from "@/components/charts/stat-tile";
import { formatSignedPercent, formatSignedScore } from "@/lib/format";
import type { Change } from "@/lib/services/analytics";

/** Turns a period comparison into a stat-tile delta. Scores compare in points, counts in percent. */
export function toDelta(change: Change, kind: "relative" | "score", upIsGood = true): StatDelta | null {
  const amount = kind === "score" ? change.absolute : change.relative;
  if (amount === null) return null;
  return {
    direction: change.direction,
    text: kind === "score" ? formatSignedScore(amount) : formatSignedPercent(amount),
    good: change.direction === "up" ? upIsGood : !upIsGood,
  };
}
