import { LayoutGrid, LogOut, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/session";
import { PRODUCT_NAME } from "@/lib/config";
import { signOutAction } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4">
          <Link href="/dashboard" className="mr-auto flex min-h-11 items-center font-semibold tracking-tight">
            {PRODUCT_NAME}
          </Link>
          <nav className="flex items-center" aria-label="Main">
            <Link href="/dashboard" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm hover:bg-muted">
              <LayoutGrid aria-hidden className="size-4" />
              <span className="hidden sm:inline">Accounts</span>
            </Link>
            <Link href="/settings" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm hover:bg-muted">
              <SlidersHorizontal aria-hidden className="size-4" />
              <span className="hidden sm:inline">Settings</span>
            </Link>
            <form action={signOutAction}>
              <Button variant="ghost" size="icon" type="submit" aria-label="Sign out" title={user.email ?? "Sign out"}>
                <LogOut aria-hidden />
              </Button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:py-6">{children}</main>
    </div>
  );
}
