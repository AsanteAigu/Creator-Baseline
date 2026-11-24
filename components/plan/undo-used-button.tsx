"use client";

import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { callApi } from "@/components/api-client";

/** Puts a used idea back on its day as proposed. The idea written to replace it stays. */
export function UndoUsedButton({ suggestionId }: { suggestionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function undo() {
    setError(null);
    startTransition(async () => {
      const result = await callApi(`/api/suggestions/${suggestionId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "proposed" }),
      });
      if (result.ok) router.refresh();
      else setError("Couldn't undo that. Please try again.");
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={undo}
        disabled={pending}
        className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Undo2 aria-hidden className="size-3.5" />
        {pending ? "Undoing…" : "Undo"}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-[#9f1f1f]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
