"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { callApi } from "@/components/api-client";

/**
 * Disconnect and delete, in two steps so a mis-tap cannot destroy a year of baselines.
 * Calls the same `DELETE /api/creators/:id` endpoint as any other client (D-033).
 */
export function DisconnectButton({ creatorId, name }: { creatorId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setMessage(null);
    const result = await callApi<undefined>(`/api/creators/${creatorId}`, { method: "DELETE" });
    if (!result.ok) {
      setBusy(false);
      setMessage(result.message);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  if (!confirming) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button variant="outline" onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden />
          Disconnect account
        </Button>
        {message ? (
          <p role="status" className="text-xs text-muted-foreground">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm">
        Disconnect <span className="font-medium">{name}</span> and delete their posts, scores, reports and plans? This
        cannot be undone.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" onClick={remove} disabled={busy}>
          <Trash2 aria-hidden />
          {busy ? "Deleting…" : "Yes, delete everything"}
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {message ? (
        <p role="status" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
}
