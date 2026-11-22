import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="surface-gradient flex min-h-dvh flex-col items-center justify-center gap-5 px-4 text-center">
      <BrandMark className="size-10" />
      <div>
        <p className="font-display text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-1 font-display text-[28px] font-medium tracking-tight">We couldn&apos;t find that page.</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          It may have moved, or the account may have been disconnected.
        </p>
      </div>
      <Link href="/dashboard" className={buttonVariants({ variant: "default" })}>
        Back to all accounts
      </Link>
    </main>
  );
}
