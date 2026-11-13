"use client";

import { useId, useState } from "react";
import { FORMAT_LABELS, formatScore } from "@/lib/format";
import type { Label } from "@/lib/scoring";

export interface TrendDatum {
  postId: string;
  /** Pre-formatted on the server in Europe/London, so server and client render identically. */
  dateLabel: string;
  format: string;
  score: number;
  label: Label;
}

const W = 640;
const H = 220;
const M = { top: 12, right: 12, bottom: 28, left: 36 };

// Status colours (reference palette); always paired with a marker shape and a word.
const STRONG = "#0ca30c";
const WEAK = "#d03b3b";
const NORMAL = "#6b6b6b";

function Marker({ label, cx, cy, active }: { label: Label; cx: number; cy: number; active: boolean }) {
  const s = active ? 7 : 5;
  const ring = { stroke: "var(--card)", strokeWidth: 2 };
  if (label === "strong") {
    return <path d={`M${cx},${cy - s} L${cx + s},${cy + s * 0.8} L${cx - s},${cy + s * 0.8} Z`} fill={STRONG} {...ring} />;
  }
  if (label === "weak") {
    return <path d={`M${cx},${cy + s} L${cx + s},${cy - s * 0.8} L${cx - s},${cy - s * 0.8} Z`} fill={WEAK} {...ring} />;
  }
  return <circle cx={cx} cy={cy} r={s * 0.8} fill={NORMAL} {...ring} />;
}

const LEGEND: { label: Label; text: string }[] = [
  { label: "strong", text: "Strong" },
  { label: "normal", text: "Normal" },
  { label: "weak", text: "Weak" },
];

export function ScoreTrendChart({
  data,
  strongCutoff,
  weakCutoff,
}: {
  data: TrendDatum[];
  strongCutoff: number;
  weakCutoff: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();

  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const yMax = Math.max(2, Math.ceil(Math.max(...data.map((d) => d.score)) * 2) / 2);
  const x = (i: number) => M.left + (data.length === 1 ? innerW / 2 : (i * innerW) / (data.length - 1));
  const y = (v: number) => M.top + innerH - (v / yMax) * innerH;
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.score).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: Math.floor(yMax / 0.5) + 1 }, (_, i) => i * 0.5);

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < data.length; i += 1) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setActive(best);
  }

  function onKey(e: React.KeyboardEvent<SVGSVGElement>) {
    if (e.key === "ArrowRight") setActive((a) => Math.min(data.length - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? data.length) - 1));
    else return;
    e.preventDefault();
  }

  const current = active === null ? null : data[active];
  const tipLeft = active === null ? 0 : (x(active) / W) * 100;

  return (
    <figure className="flex flex-col gap-3">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          role="img"
          aria-label={`Score per post, oldest to newest. ${data.length} scored posts. Use the left and right arrow keys to read each one.`}
          aria-describedby={tableId}
          tabIndex={0}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.08} />
              <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">
                {t.toFixed(1)}
              </text>
            </g>
          ))}
          {[
            { v: strongCutoff, text: `Strong above ${formatScore(strongCutoff)}` },
            { v: weakCutoff, text: `Weak below ${formatScore(weakCutoff)}` },
          ].map((ref) => (
            <g key={ref.text}>
              <line x1={M.left} x2={W - M.right} y1={y(ref.v)} y2={y(ref.v)} stroke="currentColor" strokeOpacity={0.45} strokeDasharray="4 4" />
              <text x={W - M.right} y={y(ref.v) - 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                {ref.text}
              </text>
            </g>
          ))}
          <text x={M.left} y={H - 8} className="fill-muted-foreground text-[11px]">
            {data[0]?.dateLabel}
          </text>
          <text x={W - M.right} y={H - 8} textAnchor="end" className="fill-muted-foreground text-[11px]">
            {data[data.length - 1]?.dateLabel}
          </text>

          <path d={path} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={2} strokeLinejoin="round" />
          {active !== null ? (
            <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + innerH} stroke="currentColor" strokeOpacity={0.35} />
          ) : null}
          {data.map((d, i) => (
            <Marker key={d.postId} label={d.label} cx={x(i)} cy={y(d.score)} active={i === active} />
          ))}
        </svg>

        {current ? (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm"
            style={{ left: `clamp(70px, ${tipLeft}%, calc(100% - 70px))` }}
          >
            <p className="text-base font-semibold tabular-nums">{formatScore(current.score)}</p>
            <p className="text-muted-foreground">
              {LEGEND.find((l) => l.label === current.label)?.text ?? "Normal"} · {FORMAT_LABELS[current.format] ?? current.format}
            </p>
            <p className="text-muted-foreground">{current.dateLabel}</p>
          </div>
        ) : null}
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <svg viewBox="-8 -8 16 16" className="size-3.5" aria-hidden>
              <Marker label={l.label} cx={0} cy={0} active={false} />
            </svg>
            {l.text}
          </span>
        ))}
        <span>1.00 is this creator&apos;s usual post.</span>
      </figcaption>

      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted-foreground">View as table</summary>
        <div className="max-h-64 overflow-auto">
          <table id={tableId} className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">Date</th>
                <th className="py-1 pr-2 font-medium">Format</th>
                <th className="py-1 pr-2 font-medium">Score</th>
                <th className="py-1 font-medium">Label</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.postId} className="border-t border-border">
                  <td className="py-1 pr-2">{d.dateLabel}</td>
                  <td className="py-1 pr-2">{FORMAT_LABELS[d.format] ?? d.format}</td>
                  <td className="py-1 pr-2 tabular-nums">{formatScore(d.score)}</td>
                  <td className="py-1">{LEGEND.find((l) => l.label === d.label)?.text ?? d.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
