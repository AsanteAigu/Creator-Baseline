"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Main navigation item; marks the current section for sighted and screen-reader users.
 * "side" is the desktop sidebar row, "top" the compact mobile tab.
 */
export function NavLink({
  href,
  match,
  variant = "side",
  children,
}: {
  href: string;
  match: string[];
  variant?: "side" | "top";
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = match.some((m) => pathname.startsWith(m));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative inline-flex min-h-11 items-center gap-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [&_svg]:size-[18px] [&_svg]:shrink-0",
        variant === "side" && "w-full rounded-xl px-3",
        variant === "side" &&
          (active
            ? "bg-muted text-foreground before:absolute before:-left-4 before:top-2.5 before:bottom-2.5 before:w-[3px] before:rounded-r-full before:bg-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"),
        variant === "top" && "min-w-11 justify-center gap-1.5 rounded-full px-3.5",
        variant === "top" && (active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"),
      )}
    >
      {children}
    </Link>
  );
}
