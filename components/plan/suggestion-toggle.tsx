"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { callApi } from "@/components/api-client";

type SuggestionStatus = "proposed" | "used" | "not_used";

/**
 * Used / not used, persisted and optimistic (SPECIFICATION §10). Pressing the active option
 * again clears it back to "proposed". On failure the optimistic state rolls back. "Used" also
 * writes a new idea for the day (D-047), so the page refreshes: the card moves to the tracker.
 */
export function SuggestionToggle({ suggestionId, initial }: { suggestionId: string; initial: SuggestionStatus }) {
  const router = useRouter();
  const [saved, setSaved] = useState<SuggestionStatus>(initial);
  const [optimistic, setOptimistic] = useOptimistic(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: SuggestionStatus) {
    const target = optimistic === next ? "proposed" : next;
    setError(null);
    startTransition(async () => {
      setOptimistic(target);
      const result = await callApi<{ note: string | null }>(`/api/suggestions/${suggestionId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: target }),
      });
      if (!result.ok) {
        setError("Couldn't save that. Please try again.");
        return;
      }
      setSaved(target);
      if (target === "used") {
        const note = result.data.note;
        router.replace(note ? `?notice=${encodeURIComponent(note)}#tracker` : "?notice=replaced", { scroll: false });
        router.refresh();
      }
    });
  }

  const option = (value: "used" | "not_used", text: string, Icon: typeof Check) => {
    const on = optimistic === value;
    return (
      <button
        type="button"
        aria-pressed={on}
        disabled={pending}
        onClick={() => choose(value)}
        data-testid={`suggestion-${value}`}
        className={cn(
          "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
          on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted",
        )}
      >
        <Icon aria-hidden className="size-4" />
        {text}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      {pending && optimistic === "used" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Saved. Writing a new idea for this day…
        </p>
      ) : null}
      <div className="flex gap-2" role="group" aria-label="Did you use this idea?">
        {option("used", "Used", Check)}
        {option("not_used", "Not used", X)}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-[#9f1f1f]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
