import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatDelta {
  direction: "up" | "down" | "flat";
  /** Pre-formatted, e.g. "+12.4%" or "+0.08". */
  text: string;
  /** Whether this direction is good news for this measure. */
  good: boolean;
}

/**
 * Stat tile: label, value, optional delta against a named period. The delta colour is
 * direction times whether up is good, and always comes with an arrow and words.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  comparison = "vs previous 28 days",
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: StatDelta | null;
  comparison?: string;
  icon?: LucideIcon;
}) {
  const Arrow = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : ArrowRight;
  const tone =
    !delta || delta.direction === "flat" ? "text-muted-foreground" : delta.good ? "text-good-text" : "text-critical-text";
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
      </div>
      <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {delta ? (
        <p className={cn("flex flex-wrap items-center gap-x-1 text-xs", tone)}>
          <Arrow aria-hidden className="size-3.5" />
          <span className="font-medium tabular-nums">{delta.direction === "flat" ? "No change" : delta.text}</span>
          <span className="text-muted-foreground">{comparison}</span>
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
