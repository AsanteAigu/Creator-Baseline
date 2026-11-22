import { KeyRound } from "lucide-react";
import { RunNowButton } from "@/components/account/run-now-button";
import { Banner } from "@/components/banner";
import { buttonVariants } from "@/components/ui/button";
import type { CreatorOverview } from "@/lib/services/creatorService";

/** Status banners above the account analytics: new connection, reauth, failed run, AI state. */
export function AccountBanners({
  overview: o,
  canRun,
  justConnected,
  minAgeHours,
}: {
  overview: CreatorOverview;
  canRun: boolean;
  justConnected: boolean;
  minAgeHours: number;
}) {
  const retry = (label: string) => (canRun ? <RunNowButton creatorId={o.creator.id} label={label} /> : undefined);

  return (
    <>
      {justConnected ? (
        <Banner tone="info" title="Account connected.">
          Use “Update now” to fetch this account&apos;s posts. Scores appear for posts that are at least {minAgeHours}{" "}
          hours old.
        </Banner>
      ) : null}

      {o.creator.status === "needs_reauth" ? (
        <Banner
          tone="warn"
          title="This account needs reconnecting."
          action={
            canRun ? (
              // Full navigation: the route redirects to Facebook.
              <a
                href={`/api/creators/connect?creatorId=${o.creator.id}`}
                className={buttonVariants({ variant: "outline" })}
              >
                <KeyRound aria-hidden />
                Reconnect
              </a>
            ) : undefined
          }
        >
          Instagram asked for permission again. Until it is reconnected, the scores below won&apos;t update.
        </Banner>
      ) : null}

      {o.latestRun?.status === "failed" ? (
        <Banner tone="error" title="The latest update didn't finish." action={retry("Try again")}>
          {o.latestRun.errorMessage} The scores below are from the last successful update.
        </Banner>
      ) : null}

      {o.aiNote?.code === "AI_BUDGET" ? (
        <Banner tone="info" title="AI summaries paused — monthly budget reached.">
          Scores are still up to date. An admin can raise the budget in Settings.
        </Banner>
      ) : null}

      {o.aiNote?.code === "AI_FAILED" ? (
        <Banner tone="warn" title="The written summary couldn't be generated this time." action={retry("Retry")}>
          Scores are up to date. The summary below may be from an earlier update.
        </Banner>
      ) : null}
    </>
  );
}
