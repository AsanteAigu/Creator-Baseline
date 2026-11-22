import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatDelta {
  direction: "up" | "down" | "flat";
  /** Pre-formatted, e.g. "+12.4%" or "+0.08". */
  text: string;
  /** Whether this direction is good news for this measure. */
  good: boolean;
}

/** One panel of stat tiles separated by hairlines, so a row of figures reads as one summary. */
export function StatGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={label}
      className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 shadow-card lg:grid-cols-4"
    >
      {children}
    </section>
  );
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
    !delta || delta.direction === "flat"
      ? "bg-muted text-muted-foreground"
      : delta.good
        ? "bg-[#0ca30c]/8 text-good-text"
        : "bg-[#d03b3b]/8 text-critical-text";
  return (
    <div className="flex min-w-0 flex-col gap-3 bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] text-muted-foreground">{label}</p>
        {Icon ? (
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/70">
            <Icon aria-hidden className="size-4" />
          </span>
        ) : null}
      </div>
      <p className="font-display text-[30px] font-medium leading-none tracking-tight tabular-nums text-foreground sm:text-[34px]">
        {value}
      </p>
      {delta ? (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium tabular-nums", tone)}>
            <Arrow aria-hidden className="size-3.5" />
            {delta.direction === "flat" ? "No change" : delta.text}
          </span>
          <span className="text-muted-foreground">{comparison}</span>
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
