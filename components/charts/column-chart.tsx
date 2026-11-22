"use client";

import { useId, useState } from "react";
import { formatCompact } from "@/lib/format";
import { niceTicks, useWidth } from "./use-width";

export interface ColumnDatum {
  key: string;
  /** Axis label, e.g. "Mon" or "Reel". */
  label: string;
  /** Null draws an empty slot: no posts in that group. */
  value: number | null;
  /** Pre-formatted on the server so the table renders identically on both sides. */
  valueText: string;
  /** Pre-formatted lines for the tooltip and table, e.g. "12 posts". */
  details: string[];
}

const HEIGHT = 200;
const M = { top: 16, right: 8, bottom: 26, left: 44 };
const MAX_BAR = 24;
const RADIUS = 4;

/** Column path with a rounded data end and a square baseline end. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/**
 * One series of columns from a zero baseline. Single series, so no legend: the card title names
 * it. Hover, tap or arrow keys show a tooltip; a table view carries every value.
 */
export function ColumnChart({
  data,
  valueFormat,
  ariaLabel,
  reference,
  valueHeading,
  groupHeading,
}: {
  data: ColumnDatum[];
  valueFormat: "score" | "compact";
  ariaLabel: string;
  /** Optional horizontal reference, e.g. 1.00 = the creator's usual. */
  reference?: { value: number; label: string };
  valueHeading: string;
  groupHeading: string;
}) {
  const { ref, width: measured } = useWidth<HTMLDivElement>();
  const width = measured ?? 0;
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();
  const tickFmt = valueFormat === "score" ? (v: number) => v.toFixed(1) : formatCompact;

  const values = data.map((d) => d.value ?? 0);
  const ticks = niceTicks(Math.max(...values, reference?.value ?? 0, valueFormat === "score" ? 1.5 : 1));
  const yMax = ticks[ticks.length - 1] ?? 1;
  const innerW = width - M.left - M.right;
  const innerH = HEIGHT - M.top - M.bottom;
  const band = innerW / Math.max(1, data.length);
  const barW = Math.min(MAX_BAR, band * 0.6);
  const xCenter = (i: number) => M.left + band * i + band / 2;
  const y = (v: number) => M.top + innerH - (v / yMax) * innerH;
  // Axis labels need about 48px each; thin them out rather than let them collide.
  const showEvery = Math.max(1, Math.ceil(48 / band));

  const current = active === null ? null : data[active];

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") setActive((a) => Math.min(data.length - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? data.length) - 1));
    else return;
    e.preventDefault();
  }

  return (
    <figure className="flex flex-col gap-2">
      <div ref={ref} className="relative" style={{ minHeight: HEIGHT }}>
        {measured === null ? null : (
        <svg
          width={width}
          height={HEIGHT}
          className="block select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          role="img"
          aria-label={`${ariaLabel} Use the left and right arrow keys to read each value.`}
          aria-describedby={tableId}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--chart-muted)" className="tabular-nums">
                {tickFmt(t)}
              </text>
            </g>
          ))}
          {reference ? (
            <g>
              <line x1={M.left} x2={width - M.right} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--chart-muted)" strokeDasharray="3 3" />
            </g>
          ) : null}
          {data.map((d, i) => {
            const cx = xCenter(i);
            const h = d.value === null ? 0 : Math.max(2, M.top + innerH - y(d.value));
            return (
              <g key={d.key} onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)}>
                {/* Hit target spans the whole band, bigger than the mark. */}
                <rect x={cx - band / 2} y={M.top} width={band} height={innerH} fill={i === active ? "var(--chart-band)" : "transparent"} />
                {d.value !== null ? (
                  <path d={columnPath(cx - barW / 2, M.top + innerH - h, barW, h)} fill="var(--chart-1)" opacity={active === null || active === i ? 1 : 0.55} />
                ) : (
                  <line x1={cx - barW / 2} x2={cx + barW / 2} y1={M.top + innerH - 1} y2={M.top + innerH - 1} stroke="var(--chart-axis)" strokeWidth={2} />
                )}
                {(data.length - 1 - i) % showEvery === 0 ? (
                  <text x={cx} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--chart-muted)">
                    {d.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        )}

        {current && active !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-32 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md"
            style={{ left: Math.min(Math.max(xCenter(active), 72), width - 72) }}
            role="status"
          >
            <p className="font-medium text-foreground">{current.label}</p>
            <p className="text-base font-semibold tabular-nums text-foreground">{current.valueText}</p>
            {current.details.map((line) => (
              <p key={line} className="text-muted-foreground">
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {reference ? (
        <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <svg viewBox="0 0 16 4" className="h-1 w-4" aria-hidden>
            <line x1={0} x2={16} y1={2} y2={2} stroke="var(--chart-muted)" strokeDasharray="3 3" />
          </svg>
          {reference.label}
        </figcaption>
      ) : null}
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-medium text-muted-foreground hover:text-foreground">View as table</summary>
        <table id={tableId} className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-2 font-medium">{groupHeading}</th>
              <th className="py-1 pr-2 font-medium">{valueHeading}</th>
              <th className="py-1 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key} className="border-t border-border">
                <td className="py-1 pr-2">{d.label}</td>
                <td className="py-1 pr-2 tabular-nums">{d.value === null ? "–" : d.valueText}</td>
                <td className="py-1 text-muted-foreground">{d.details.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
