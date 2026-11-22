import { ArrowUpRight, CalendarDays } from "lucide-react";
import Link from "next/link";

export function PlanCallout({ creatorId, name }: { creatorId: string; name: string }) {
  return (
    <Link
      href={`/accounts/${creatorId}/plan`}
      className="surface-gradient group flex items-center justify-between gap-4 rounded-xl border border-white/60 p-6 shadow-card transition-shadow hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:p-8"
    >
      <span className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-foreground/70">
          <CalendarDays aria-hidden className="size-4" /> Content plan
        </span>
        <span className="font-display text-xl font-medium tracking-tight sm:text-2xl">
          See this week&apos;s content plan
        </span>
        <span className="text-sm text-foreground/70">Ideas drafted from what is working for {name}.</span>
      </span>
      <span
        aria-hidden
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-card text-foreground shadow-card transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
      >
        <ArrowUpRight className="size-5" />
      </span>
    </Link>
  );
}
