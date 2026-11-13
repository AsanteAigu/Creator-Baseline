import { cn } from "@/lib/utils";

/** Reserves the exact space of the content it stands in for, so nothing shifts on load. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
