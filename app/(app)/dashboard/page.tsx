import {
  AlertTriangle,
  ArrowUpRight,
  Eye,
  Gauge,
  ImageIcon,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { Banner } from "@/components/banner";
import { StatGroup, StatTile } from "@/components/charts/stat-tile";
import { CreatorAvatar } from "@/components/creator-avatar";
import { EmptyState } from "@/components/empty-state";
import { Sparkline } from "@/components/charts/sparkline";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requirePageUser, withPageErrors } from "@/app/(app)/page-helpers";
import { toDelta } from "@/components/charts/stat-delta";
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

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ connect?: string }> }) {
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
      <section className="surface-gradient relative overflow-hidden rounded-xl border border-white/60 p-6 shadow-card sm:p-8">
        <HeroMotif />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-[32px] font-medium leading-tight tracking-tight sm:text-[40px]">
              Overview
            </h1>
            <p className="mt-1 max-w-xl text-sm text-foreground/70 sm:text-[15px]">
              Every account measured against its own usual results. Last 28 days.
            </p>
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
      </section>

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
        <Banner
          tone="error"
          title={`The last update didn't finish for ${failed.map((c) => `@${c.creator.username}`).join(", ")}.`}
        >
          {failed[0]?.latestRun?.errorMessage ?? "We'll try again at the next scheduled update."} Earlier scores are
          still shown.
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
          <StatGroup label="Portfolio summary">
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
          </StatGroup>

          <section aria-labelledby="accounts-heading" className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="accounts-heading" className="font-display text-xl font-medium tracking-tight">
                Accounts
              </h2>
              <p className="rounded-full bg-card px-3 py-1 text-xs text-muted-foreground shadow-card">
                {portfolio.accounts} connected
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map(({ creator, latestRun, trend, averageScore, period }) => (
                <li key={creator.id}>
                  <Link
                    href={`/accounts/${creator.id}`}
                    className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                  >
                    <Card className="flex h-full flex-col gap-5 p-5 transition-[box-shadow,transform] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lift sm:p-6">
                      <div className="flex items-center gap-3">
                        <CreatorAvatar name={creator.displayName ?? creator.username} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{creator.displayName ?? creator.username}</p>
                          <p className="truncate text-[13px] text-muted-foreground">@{creator.username}</p>
                        </div>
                        <span
                          aria-hidden
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/70 transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                        >
                          <ArrowUpRight className="size-4" />
                        </span>
                      </div>
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-[13px] text-muted-foreground">Recent average score</p>
                          <p className="mt-1 font-display text-[40px] font-medium leading-none tracking-tight tabular-nums">
                            {averageScore === null ? "–" : formatScore(averageScore)}
                          </p>
                        </div>
                        <Sparkline values={trend} />
                      </div>
                      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border/70 text-xs">
                        <div className="bg-muted/70 px-3 py-2.5">
                          <dt className="text-muted-foreground">Reach, 28 days</dt>
                          <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">
                            {formatCompact(period.totalReach)}
                          </dd>
                        </div>
                        <div className="bg-muted/70 px-3 py-2.5">
                          <dt className="text-muted-foreground">Posts, 28 days</dt>
                          <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">
                            {formatNumber(period.posts)}
                          </dd>
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
                        <span className="inline-flex items-center gap-1.5">
                          <RefreshCw aria-hidden className="size-3.5" />
                          {creator.lastSyncedAt ? `Updated ${formatDateTime(creator.lastSyncedAt)}` : "Not updated yet"}
                        </span>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          {portfolio.needsAttention > 0 ? (
            <p className="flex items-center gap-2 rounded-xl bg-card px-4 py-3 text-xs text-muted-foreground shadow-card">
              <ShieldAlert aria-hidden className="size-4" />
              {portfolio.needsAttention} account{portfolio.needsAttention === 1 ? " needs" : "s need"} attention. Open
              the account to reconnect or retry.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

/** Decorative rising line over a dashed baseline: the product idea, drawn behind the hero text. */
function HeroMotif() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute -right-10 bottom-0 h-full w-[70%] max-w-[560px] opacity-70"
      viewBox="0 0 560 200"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="hero-line" x1="0" x2="1">
          <stop offset="0" stopColor="#2a78d6" stopOpacity="0" />
          <stop offset="1" stopColor="#2a78d6" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="hero-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2a78d6" stopOpacity="0.12" />
          <stop offset="1" stopColor="#2a78d6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2="560" y1="130" y2="130" stroke="#1d2433" strokeOpacity="0.18" strokeDasharray="4 6" />
      <path
        d="M0 160 L80 140 L150 150 L230 110 L300 125 L380 80 L450 95 L560 40 L560 200 L0 200 Z"
        fill="url(#hero-fill)"
      />
      <path
        d="M0 160 L80 140 L150 150 L230 110 L300 125 L380 80 L450 95 L560 40"
        fill="none"
        stroke="url(#hero-line)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
