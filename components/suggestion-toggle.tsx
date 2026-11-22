"use client";

import { Check, X } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { callApi } from "./api-client";

type SuggestionStatus = "proposed" | "used" | "not_used";

/**
 * Used / not used, persisted and optimistic (BUILD_PROMPT §10). Pressing the active option
 * again clears it back to "proposed". On failure the optimistic state rolls back.
 */
export function SuggestionToggle({ suggestionId, initial }: { suggestionId: string; initial: SuggestionStatus }) {
  const [saved, setSaved] = useState<SuggestionStatus>(initial);
  const [optimistic, setOptimistic] = useOptimistic(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: SuggestionStatus) {
    const target = optimistic === next ? "proposed" : next;
    setError(null);
    startTransition(async () => {
      setOptimistic(target);
      const result = await callApi(`/api/suggestions/${suggestionId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: target }),
      });
      if (result.ok) setSaved(target);
      else setError("Couldn't save that. Please try again.");
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
