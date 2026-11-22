import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Period switch as plain links: the page is server-rendered, so each choice is a URL that
 * can be shared or bookmarked, and it works without JavaScript.
 */
export function RangeTabs({
  options,
  current,
  hrefFor,
}: {
  options: { value: number; label: string }[];
  current: number;
  hrefFor: (value: number) => string;
}) {
  return (
    <nav aria-label="Period" className="inline-flex rounded-full border border-border/70 bg-card p-1 shadow-card">
      {options.map((o) => {
        const active = o.value === current;
        return (
          <Link
            key={o.value}
            href={hrefFor(o.value)}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
