"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { callApi } from "@/components/api-client";

export function RunNowButton({ creatorId, label = "Update now" }: { creatorId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function run() {
    setBusy(true);
    setMessage(null);
    const result = await callApi<{ status: string; errorMessage?: string; aiPending?: boolean }>(
      `/api/creators/${creatorId}/runs`,
      {
        method: "POST",
      },
    );
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (result.data.status === "failed") setMessage(result.data.errorMessage ?? "The update didn't finish.");
    startTransition(() => router.refresh());
    if (result.data.aiPending) {
      setMessage("Scores are up to date. The written summary will follow shortly.");
      // The summary is written after the response; one later refresh picks it up.
      window.setTimeout(() => startTransition(() => router.refresh()), 45_000);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" onClick={run} disabled={busy}>
        <RefreshCw aria-hidden className={busy ? "animate-spin" : undefined} />
        {busy ? "Updating…" : label}
      </Button>
      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
