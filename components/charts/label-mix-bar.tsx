import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { formatPercent } from "@/lib/format";

const PARTS = [
  { key: "strong", text: "Strong", colour: "var(--status-good)", Icon: TrendingUp },
  { key: "normal", text: "Normal", colour: "var(--status-neutral)", Icon: Minus },
  { key: "weak", text: "Weak", colour: "var(--status-critical)", Icon: TrendingDown },
] as const;

/**
 * One whole split into parts: how the scored posts divide across labels. Segments are
 * separated by a 2px surface gap; the legend carries counts and shares, so colour is never
 * the only cue.
 */
export function LabelMixBar({ counts }: { counts: Record<"strong" | "normal" | "weak", number> }) {
  const total = counts.strong + counts.normal + counts.weak;
  if (total === 0) return <p className="text-sm text-muted-foreground">No posts scored in this period.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full"
        role="img"
        aria-label={PARTS.map((p) => `${p.text} ${counts[p.key]}`).join(", ")}
      >
        {PARTS.filter((p) => counts[p.key] > 0).map((p) => (
          <div key={p.key} style={{ width: `${(counts[p.key] / total) * 100}%`, background: p.colour }} />
        ))}
      </div>
      <ul className="grid grid-cols-3 gap-2 text-xs">
        {PARTS.map(({ key, text, colour, Icon }) => (
          <li key={key} className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: colour }} />
              <Icon aria-hidden className="size-3.5 shrink-0" />
              {text}
            </span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {counts[key]} <span className="font-normal text-muted-foreground">({formatPercent(counts[key] / total)})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
