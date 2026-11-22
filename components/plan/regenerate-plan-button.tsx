"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { callApi } from "@/components/api-client";

export function RegeneratePlanButton({ creatorId, label = "Refresh ideas" }: { creatorId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function regenerate() {
    setBusy(true);
    setMessage(null);
    const result = await callApi(`/api/creators/${creatorId}/plans/regenerate`, { method: "POST" });
    setBusy(false);
    if (!result.ok) setMessage(result.message);
    else startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" onClick={regenerate} disabled={busy}>
        <Sparkles aria-hidden />
        {busy ? "Refreshing…" : label}
      </Button>
      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
