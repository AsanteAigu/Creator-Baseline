import { AlertTriangle, KeyRound, UserPlus } from "lucide-react";
import Link from "next/link";
import { Banner } from "@/components/banner";
import { CreatorAvatar } from "@/components/creator-avatar";
import { EmptyState } from "@/components/empty-state";
import { Sparkline } from "@/components/sparkline";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requirePageUser, withPageErrors } from "@/app/(app)/page-helpers";
import { formatDateTime, formatScore } from "@/lib/format";
import { listCreatorCards } from "@/lib/services/creatorService";

export const metadata = { title: "Accounts" };

/** Coarse reasons from the OAuth callback; nothing Meta said is echoed. */
const CONNECT_ERRORS: Record<string, string> = {
  denied: "The Facebook login was cancelled, so nothing changed.",
  state: "That connection link expired. Please start again.",
  mismatch: "That login belongs to a different Instagram account. To add it, use Connect account.",
  forbidden: "Only owners and admins can connect accounts.",
  failed:
    "We couldn't connect that account. Check that it is an Instagram professional account linked to a Facebook Page, then try again.",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>;
}) {
  const userId = await requirePageUser();
  const result = await withPageErrors(() => listCreatorCards(userId));
  if ("message" in result) return <Banner tone="warn" title={result.message} />;
  const { context, cards } = result;
  const failed = cards.filter((c) => c.latestRun?.status === "failed");
  const canManage = context.role === "owner" || context.role === "admin";
  const connect = (await searchParams).connect;
  const connectError = connect !== undefined ? CONNECT_ERRORS[connect] : undefined;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground">{context.workspaceName}</p>
        </div>
        {canManage ? (
          // A full navigation, not a client-side Link: this route redirects to Facebook.
          <a href="/api/creators/connect" className={buttonVariants({ variant: "outline" })}>
            <UserPlus aria-hidden />
            Connect account
          </a>
        ) : null}
      </div>

      {connect === "ok" ? (
        <Banner tone="info" title="Account connected.">
          Scores will appear after the account&apos;s first update.
        </Banner>
      ) : null}
      {connectError !== undefined ? (
        <Banner tone="error" title="Account not connected.">
          {connectError}
        </Banner>
      ) : null}

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
