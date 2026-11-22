import { CircleHelp, LayoutGrid, LogOut, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { CreatorAvatar } from "@/components/creator-avatar";
import { NavLink } from "@/components/nav-link";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/session";
import { PRODUCT_NAME } from "@/lib/config";
import { signOutAction } from "../login/actions";

// Every page in this segment reads the session cookie and live tenant data.
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/dashboard", match: ["/dashboard", "/accounts"], label: "Overview", Icon: LayoutGrid },
  { href: "/settings", match: ["/settings"], label: "Settings", Icon: SlidersHorizontal },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const email = user.email ?? "";

  return (
    <div className="min-h-dvh bg-page lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-border/70 bg-sidebar px-4 py-6 lg:flex">
        <Link
          href="/dashboard"
          className="flex min-h-11 items-center gap-2.5 rounded-xl px-2 font-display text-[17px] font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <BrandMark className="size-8" />
          {PRODUCT_NAME}
        </Link>

        <nav aria-label="Main" className="mt-8 flex flex-col gap-1">
          <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">Workspace</p>
          {NAV.map(({ href, match, label, Icon }) => (
            <NavLink key={href} href={href} match={[...match]}>
              <Icon aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-4">
          <div className="surface-gradient rounded-xl p-4">
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-card/80 text-foreground shadow-card">
              <CircleHelp aria-hidden className="size-4" />
            </span>
            <p className="mt-3 font-display text-[15px] font-medium leading-snug">How scores work</p>
            <p className="mt-1 text-xs leading-relaxed text-foreground/70">
              1.00 is the creator&apos;s usual result for that format. Above 1.00 beats it; below falls short.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border/70 p-2 pl-3">
            <CreatorAvatar name={email || "?"} className="size-9 text-xs ring-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">Signed in</p>
              <p className="truncate text-xs text-muted-foreground" title={email}>
                {email}
              </p>
            </div>
            <form action={signOutAction}>
              <Button variant="ghost" size="icon" type="submit" aria-label="Sign out" title="Sign out">
                <LogOut aria-hidden />
              </Button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border/70 bg-page/85 backdrop-blur-md lg:hidden">
          <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
            <Link href="/dashboard" className="mr-auto flex min-h-11 items-center gap-2.5 font-display font-semibold tracking-tight">
              <BrandMark className="size-8" />
              <span className="hidden min-[400px]:inline">{PRODUCT_NAME}</span>
            </Link>
            <nav className="flex items-center gap-1" aria-label="Main">
              {NAV.map(({ href, match, label, Icon }) => (
                <NavLink key={href} href={href} match={[...match]} variant="top">
                  <Icon aria-hidden />
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sr-only sm:hidden">{label}</span>
                </NavLink>
              ))}
            </nav>
            <form action={signOutAction}>
              <Button variant="ghost" size="icon" type="submit" aria-label="Sign out" title="Sign out">
                <LogOut aria-hidden />
              </Button>
            </form>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
