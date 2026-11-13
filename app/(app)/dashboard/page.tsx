import { AlertTriangle, KeyRound } from "lucide-react";
import Link from "next/link";
import { Banner } from "@/components/banner";
import { CreatorAvatar } from "@/components/creator-avatar";
import { EmptyState } from "@/components/empty-state";
import { Sparkline } from "@/components/sparkline";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requirePageUser, withPageErrors } from "@/app/(app)/page-helpers";
import { formatDateTime, formatScore } from "@/lib/format";
import { listCreatorCards } from "@/lib/services/creatorService";

export const metadata = { title: "Accounts" };

export default async function DashboardPage() {
  const userId = await requirePageUser();
  const result = await withPageErrors(() => listCreatorCards(userId));
  if ("message" in result) return <Banner tone="warn" title={result.message} />;
  const { context, cards } = result;
  const failed = cards.filter((c) => c.latestRun?.status === "failed");

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Accounts</h1>
        <p className="text-sm text-muted-foreground">{context.workspaceName}</p>
      </div>

      {failed.length > 0 ? (
        <Banner tone="error" title={`The last update didn't finish for ${failed.map((c) => `@${c.creator.username}`).join(", ")}.`}>
          {failed[0]?.latestRun?.errorMessage ?? "We'll try again at the next scheduled update."} Earlier scores are still shown.
        </Banner>
      ) : null}

      {cards.length === 0 ? (
        <EmptyState title="No accounts connected yet.">Ask your agency admin to connect a creator&apos;s Instagram account.</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ creator, latestRun, trend, averageScore }) => (
            <li key={creator.id}>
              <Link href={`/accounts/${creator.id}`} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <Card className="flex h-full flex-col gap-3 p-4 transition-colors hover:bg-muted/40">
                  <div className="flex items-center gap-3">
                    <CreatorAvatar name={creator.displayName ?? creator.username} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{creator.displayName ?? creator.username}</p>
                      <p className="truncate text-sm text-muted-foreground">@{creator.username}</p>
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Recent average</p>
                      <p className="text-2xl font-semibold tabular-nums">{averageScore === null ? "–" : formatScore(averageScore)}</p>
                    </div>
                    <Sparkline values={trend} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {creator.status === "needs_reauth" ? (
                      <Badge tone="warn">
                        <KeyRound aria-hidden />
                        Needs reconnecting
                      </Badge>
                    ) : null}
                    {latestRun?.status === "failed" ? (
                      <Badge tone="bad">
                        <AlertTriangle aria-hidden />
                        Last update failed
                      </Badge>
                    ) : null}
                    <span>{creator.lastSyncedAt ? `Updated ${formatDateTime(creator.lastSyncedAt)}` : "Not updated yet"}</span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
