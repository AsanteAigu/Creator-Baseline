"use client";

import { useId, useState } from "react";
import { niceTicks, useWidth } from "@/components/charts/use-width";
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

const HEIGHT = 260;
const M = { top: 16, right: 16, bottom: 30, left: 40 };

// Status colours (reference palette); always paired with a marker shape and a word.
const COLOURS: Partial<Record<Label, string>> = {
  strong: "var(--status-good)",
  weak: "var(--status-critical)",
  normal: "var(--status-neutral)",
};

function Marker({ label, cx, cy, active }: { label: Label; cx: number; cy: number; active: boolean }) {
  const s = active ? 6.5 : 4.5;
  const ring = { stroke: "var(--card)", strokeWidth: 2 };
  const fill = COLOURS[label] ?? "var(--status-neutral)";
  if (label === "strong") {
    return <path d={`M${cx},${cy - s} L${cx + s},${cy + s * 0.8} L${cx - s},${cy + s * 0.8} Z`} fill={fill} {...ring} />;
  }
  if (label === "weak") {
    return <path d={`M${cx},${cy + s} L${cx + s},${cy - s * 0.8} L${cx - s},${cy - s * 0.8} Z`} fill={fill} {...ring} />;
  }
  return <circle cx={cx} cy={cy} r={s * 0.8} fill={fill} {...ring} />;
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
  const { ref, width: measured } = useWidth<HTMLDivElement>();
  const width = measured ?? 0;
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();

  const ticks = niceTicks(Math.max(2, strongCutoff, ...data.map((d) => d.score)), 4);
  const yMax = ticks[ticks.length - 1] ?? 2;
  const innerW = width - M.left - M.right;
  const innerH = HEIGHT - M.top - M.bottom;
  const x = (i: number) => M.left + (data.length === 1 ? innerW / 2 : (i * innerW) / (data.length - 1));
  const y = (v: number) => M.top + innerH - (v / yMax) * innerH;
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.score).toFixed(1)}`).join(" ");

  // Roughly one date label per 110px, always including both ends.
  const labelCount = Math.max(2, Math.min(data.length, Math.floor(innerW / 110)));
  const dateIdx = Array.from(new Set(Array.from({ length: labelCount }, (_, k) => Math.round((k * (data.length - 1)) / (labelCount - 1)))));

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
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

  return (
    <figure className="flex flex-col gap-3">
      <div ref={ref} className="relative" style={{ minHeight: HEIGHT }}>
        {measured === null ? null : (
          <svg
            width={width}
            height={HEIGHT}
            className="block touch-pan-y select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
            {/* The normal range: between the weak and strong cutoffs. */}
            <rect x={M.left} width={innerW} y={y(strongCutoff)} height={y(weakCutoff) - y(strongCutoff)} fill="var(--chart-band)" />
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--chart-muted)" className="tabular-nums">
                  {t.toFixed(1)}
                </text>
              </g>
            ))}
            <line x1={M.left} x2={width - M.right} y1={y(1)} y2={y(1)} stroke="var(--chart-muted)" strokeDasharray="3 3" />
            {dateIdx.map((i) => (
              <text
                key={i}
                x={x(i)}
                y={HEIGHT - 8}
                textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                fontSize={11}
                fill="var(--chart-muted)"
              >
                {data[i]?.dateLabel}
              </text>
            ))}

            <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {active !== null ? (
              <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + innerH} stroke="var(--chart-axis)" />
            ) : null}
            {data.map((d, i) => (
              <Marker key={d.postId} label={d.label} cx={x(i)} cy={y(d.score)} active={i === active} />
            ))}
          </svg>
        )}

        {current && active !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-32 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md"
            style={{ left: Math.min(Math.max(x(active), 72), width - 72) }}
            role="status"
          >
            <p className="text-base font-semibold tabular-nums text-foreground">{formatScore(current.score)}</p>
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
        <span className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 16 4" className="h-1 w-4" aria-hidden>
            <line x1={0} x2={16} y1={2} y2={2} stroke="var(--chart-muted)" strokeDasharray="3 3" />
          </svg>
          1.00 is this creator&apos;s usual post
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-4 rounded-sm bg-[var(--chart-band)] ring-1 ring-inset ring-[var(--chart-grid)]" />
          Normal range, {formatScore(weakCutoff)} to {formatScore(strongCutoff)}
        </span>
      </figcaption>

      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-medium text-muted-foreground hover:text-foreground">View as table</summary>
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
