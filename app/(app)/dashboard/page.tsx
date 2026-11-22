import { AlertTriangle, ArrowUpRight, Eye, Gauge, ImageIcon, KeyRound, ShieldAlert, UserPlus } from "lucide-react";
import Link from "next/link";
import { Banner } from "@/components/banner";
import { StatTile } from "@/components/charts/stat-tile";
import { CreatorAvatar } from "@/components/creator-avatar";
import { EmptyState } from "@/components/empty-state";
import { Sparkline } from "@/components/sparkline";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requirePageUser, withPageErrors } from "@/app/(app)/page-helpers";
import { toDelta } from "@/app/(app)/stat-helpers";
import { formatCompact, formatDateTime, formatNumber, formatPercent, formatScore } from "@/lib/format";
import { compareValues } from "@/lib/services/analytics";
import { listCreatorCards } from "@/lib/services/creatorService";

export const metadata = { title: "Overview" };

/** Coarse reasons from the OAuth callback; nothing Meta said is echoed. */
const CONNECT_ERRORS: Record<string, string> = {
  denied: "The Facebook login was cancelled, so nothing changed.",
  state: "That connection link expired. Please start again.",
  mismatch: "That login belongs to a different Instagram account. To add it, use Connect account.",
  forbidden: "Only owners and admins can connect accounts.",
  failed:
    "We couldn't connect that account. Check that it is an Instagram professional account in your Meta business portfolio, that you selected exactly one account, then try again.",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>;
}) {
  const userId = await requirePageUser();
  const result = await withPageErrors(() => listCreatorCards(userId));
  if ("message" in result) return <Banner tone="warn" title={result.message} />;
  const { context, cards, portfolio } = result;
  const failed = cards.filter((c) => c.latestRun?.status === "failed");
  const canManage = context.role === "owner" || context.role === "admin";
  // A creator login connects its own Instagram once (D-011); afterwards it only sees that account.
  const isCreator = context.role === "creator";
  const canConnect = canManage || (isCreator && context.creatorId === null);
  const connect = (await searchParams).connect;
  const connectError = connect !== undefined ? CONNECT_ERRORS[connect] : undefined;
  const { current, previous } = portfolio;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{context.workspaceName}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every account measured against its own usual results. Last 28 days.</p>
        </div>
        {canConnect ? (
          // A full navigation, not a client-side Link: this route redirects to Facebook.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/api/creators/connect" className={buttonVariants({ variant: "default" })}>
            <UserPlus aria-hidden />
            {isCreator ? "Connect your Instagram" : "Connect account"}
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
        <EmptyState title="No accounts connected yet.">
          {isCreator
            ? "Use “Connect your Instagram” above. You'll log in to Instagram on Meta's screen and pick your account."
            : canManage
              ? "Connect a creator's Instagram, or invite the creator from Settings so they can connect it themselves."
              : "Ask your agency admin to connect a creator's Instagram account."}
        </EmptyState>
      ) : (
        <>
          <section aria-label="Portfolio summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Total reach"
              icon={Eye}
              value={formatCompact(current.totalReach)}
              delta={toDelta(compareValues(current.totalReach, previous.totalReach), "relative")}
            />
            <StatTile
              label="Average score"
              icon={Gauge}
              value={current.averageScore === null ? "–" : formatScore(current.averageScore)}
              delta={toDelta(compareValues(current.averageScore, previous.averageScore), "score")}
            />
            <StatTile
              label="Posts published"
              icon={ImageIcon}
              value={formatNumber(current.posts)}
              delta={toDelta(compareValues(current.posts, previous.posts), "relative")}
            />
            <StatTile
              label="Strong posts"
              icon={ArrowUpRight}
              value={current.strongShare === null ? "–" : formatPercent(current.strongShare)}
              hint={`${formatNumber(current.scored)} scored · ${portfolio.needsAttention === 0 ? "all accounts healthy" : `${portfolio.needsAttention} need attention`}`}
            />
          </section>

          <section aria-labelledby="accounts-heading" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="accounts-heading" className="text-base font-semibold tracking-tight">
                Accounts
              </h2>
              <p className="text-xs text-muted-foreground">
                {portfolio.accounts} connected
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map(({ creator, latestRun, trend, averageScore, period }) => (
                <li key={creator.id}>
                  <Link
                    href={`/accounts/${creator.id}`}
                    className="group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <Card className="flex h-full flex-col gap-4 p-5 transition-shadow group-hover:shadow-md">
                      <div className="flex items-center gap-3">
                        <CreatorAvatar name={creator.displayName ?? creator.username} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{creator.displayName ?? creator.username}</p>
                          <p className="truncate text-sm text-muted-foreground">@{creator.username}</p>
                        </div>
                        <ArrowUpRight aria-hidden className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Recent average score</p>
                          <p className="text-3xl font-semibold tracking-tight tabular-nums">{averageScore === null ? "–" : formatScore(averageScore)}</p>
                        </div>
                        <Sparkline values={trend} />
                      </div>
                      <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
                        <div>
                          <dt className="text-muted-foreground">Reach, 28 days</dt>
                          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{formatCompact(period.totalReach)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Posts, 28 days</dt>
                          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{formatNumber(period.posts)}</dd>
                        </div>
                      </dl>
                      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
          </section>
          {portfolio.needsAttention > 0 ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldAlert aria-hidden className="size-4" />
              {portfolio.needsAttention} account{portfolio.needsAttention === 1 ? " needs" : "s need"} attention. Open the account to reconnect or retry.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
