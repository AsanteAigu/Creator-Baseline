"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Main navigation item; marks the current section for sighted and screen-reader users. */
export function NavLink({ href, match, children }: { href: string; match: string[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = match.some((m) => pathname.startsWith(m));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors [&_svg]:size-4",
        active ? "text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "after:absolute after:inset-x-3 after:-bottom-[9px] after:h-0.5 after:rounded-full after:bg-primary",
      )}
    >
      {children}
    </Link>
  );
}
