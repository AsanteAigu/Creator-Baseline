import { formatScore } from "@/lib/format";

const W = 120;
const H = 36;
const PAD = 3;

/**
 * Recent scores at a glance. Single series, so no legend: the surrounding text names it.
 * A dashed line marks 1.00, the creator's usual.
 */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(2, ...values);
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (values.length - 1);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-9 w-[120px] shrink-0 overflow-visible"
      role="img"
      aria-label={`Last ${values.length} scores, from ${formatScore(first)} to ${formatScore(last)}`}
    >
      <line x1={PAD} x2={W - PAD} y1={y(1)} y2={y(1)} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="2 3" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={3.5} fill="currentColor" stroke="var(--card)" strokeWidth={2} />
    </svg>
  );
}
