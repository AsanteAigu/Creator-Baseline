import { AiDisclaimer } from "@/components/ai-disclaimer";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercent } from "@/lib/format";
import type { CreatorOverview } from "@/lib/services/creatorService";

const SENTIMENTS = ["positive", "neutral", "negative"] as const;
const SENTIMENT_TEXT = { positive: "Positive", neutral: "Neutral", negative: "Negative" } as const;
const SENTIMENT_BAR = { positive: "bg-good", neutral: "bg-[var(--status-neutral)]", negative: "bg-critical" } as const;
const SENTIMENT_TONE = { positive: "good", neutral: "neutral", negative: "bad" } as const;

/** Comment sentiment split and themes. Built from aggregates only; no comment text is stored. */
export function AudienceThemesCard({ insight }: { insight: CreatorOverview["insight"] }) {
  const total = insight ? insight.positive + insight.neutral + insight.negative : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audience themes</CardTitle>
        {insight ? (
          <CardDescription>
            From {insight.commentsSampled} recent comments. Comments themselves are never stored.
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {insight && total > 0 ? (
          <>
            <div>
              <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
                {SENTIMENTS.map((k) => (
                  <div key={k} className={SENTIMENT_BAR[k]} style={{ width: `${(insight[k] / total) * 100}%` }} />
                ))}
              </div>
              <p className="mt-2 text-sm">
                {SENTIMENTS.map((k, i) => (
                  <span key={k}>
                    {i > 0 ? " · " : ""}
                    {SENTIMENT_TEXT[k]} {formatPercent(insight[k] / total)}
                  </span>
                ))}
              </p>
            </div>
            <ul className="flex flex-col divide-y divide-border">
              {insight.themes.map((t) => (
                <li key={t.label} className="py-3 first:pt-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t.label}</p>
                    <Badge tone={SENTIMENT_TONE[t.sentiment]}>
                      {SENTIMENT_TEXT[t.sentiment]} · {t.count}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{t.exampleParaphrase}</p>
                </li>
              ))}
            </ul>
            <AiDisclaimer />
          </>
        ) : (
          <EmptyState title="No comment themes yet.">Themes appear once recent posts have comments to read.</EmptyState>
        )}
      </CardContent>
    </Card>
  );
}
