import { LayoutGrid, LogOut, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { NavLink } from "@/components/nav-link";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/session";
import { PRODUCT_NAME } from "@/lib/config";
import { signOutAction } from "../login/actions";

// Every page in this segment reads the session cookie and live tenant data.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-dvh bg-page">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link href="/dashboard" className="mr-auto flex min-h-11 items-center gap-2.5 font-semibold tracking-tight">
            <BrandMark className="size-7" />
            <span className="hidden min-[380px]:inline">{PRODUCT_NAME}</span>
          </Link>
          <nav className="flex items-center gap-1" aria-label="Main">
            <NavLink href="/dashboard" match={["/dashboard", "/accounts"]}>
              <LayoutGrid aria-hidden />
              <span className="hidden sm:inline">Overview</span>
            </NavLink>
            <NavLink href="/settings" match={["/settings"]}>
              <SlidersHorizontal aria-hidden />
              <span className="hidden sm:inline">Settings</span>
            </NavLink>
          </nav>
          <div className="ml-1 flex items-center gap-2 border-l border-border pl-3">
            {user.email ? (
              <span className="hidden max-w-48 truncate text-xs text-muted-foreground lg:inline">{user.email}</span>
            ) : null}
            <form action={signOutAction}>
              <Button variant="ghost" size="icon" type="submit" aria-label="Sign out" title="Sign out">
                <LogOut aria-hidden />
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
