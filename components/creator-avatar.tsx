import { cn } from "@/lib/utils";

/** Initials only: no third-party image requests from the dashboard. */
export function CreatorAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/[\s._]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold", className)}
    >
      {initials}
    </span>
  );
}
