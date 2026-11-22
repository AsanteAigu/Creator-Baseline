import { Check, X } from "lucide-react";
import { AiDisclaimer } from "@/components/ai-disclaimer";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type { CreatorOverview } from "@/lib/services/creatorService";

/** The AI-written analysis for the period: a headline plus what is and isn't working. */
export function ReportCard({
  report,
  isCurrent,
  canRun,
}: {
  report: CreatorOverview["report"];
  isCurrent: boolean;
  canRun: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What&apos;s working and what isn&apos;t</CardTitle>
        {report ? (
          <CardDescription>
            {formatDate(report.periodStart)} to {formatDate(report.periodEnd)}
            {isCurrent ? "" : " · from an earlier update"}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {report ? (
          <>
            <p className="font-display text-lg font-medium leading-snug tracking-tight">{report.headline}</p>
            <ReportList title="Working" tone="good" items={report.whatWorking} />
            <ReportList title="Not working" tone="bad" items={report.whatNotWorking} />
            <AiDisclaimer />
          </>
        ) : (
          <EmptyState title="No written summary yet.">
            {canRun ? "Start an update to generate one." : "It will appear after the next update."}
          </EmptyState>
        )}
      </CardContent>
    </Card>
  );
}

function ReportList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "good" | "bad";
  items: { point: string; evidence: string }[];
}) {
  const Icon = tone === "good" ? Check : X;
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      <ul className="mt-2 flex flex-col gap-3 text-sm">
        {items.map((item) => (
          <li key={item.point} className="flex gap-3">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                tone === "good" ? "bg-[#0ca30c]/10 text-good-text" : "bg-[#d03b3b]/10 text-critical-text",
              )}
            >
              <Icon className="size-3" />
            </span>
            <span>
              {item.point}
              <span className="mt-0.5 block text-muted-foreground">{item.evidence}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
