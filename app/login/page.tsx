import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { getSessionUser } from "@/lib/auth/session";
import { PRODUCT_NAME } from "@/lib/config";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

// Reads the session cookie: never prerender this page at build time.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/dashboard");
  return (
    <main className="grid min-h-dvh bg-page lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <div className="flex items-center gap-2.5 font-display text-[17px] font-semibold tracking-tight">
          <BrandMark className="size-8" />
          {PRODUCT_NAME}
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="font-display text-[32px] font-medium leading-tight tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to see how every post compares with the creator&apos;s own usual.
          </p>
          <div className="mt-8 rounded-xl border border-border/70 bg-card p-6 shadow-card">
            <LoginForm />
          </div>
          <p className="mt-6 text-center text-[13px] text-muted-foreground">New here? Open the invite link your agency sent you.</p>
        </div>
      </div>

      <LoginVisual />
    </main>
  );
}

/** Decorative panel: the product idea (posts against a personal baseline) as an illustration, no real data. */
function LoginVisual() {
  const bars = [0.62, 0.88, 0.74, 1.18, 0.96, 1.36, 1.08, 1.52];
  return (
    <div aria-hidden className="relative hidden p-4 lg:block">
      <div className="surface-gradient-deep relative flex h-full flex-col justify-between overflow-hidden rounded-[28px] p-12 text-white">
        <svg className="absolute inset-0 h-full w-full opacity-[0.08]" preserveAspectRatio="none">
          <defs>
            <pattern id="login-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#login-grid)" />
        </svg>

        <p className="relative max-w-md font-display text-[40px] font-medium leading-[1.1] tracking-tight">
          Every post, measured against their own usual.
        </p>

        <div className="glass relative mx-auto w-full max-w-md rounded-2xl p-6 text-foreground shadow-2xl">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-muted-foreground">Score per post</p>
            <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">Last 8 posts</span>
          </div>
          <div className="relative mt-6 flex h-40 items-end gap-3">
            <div className="absolute inset-x-0 border-t border-dashed border-foreground/30" style={{ bottom: `${(1 / 1.6) * 100}%` }}>
              <span className="absolute -top-5 left-0 text-[11px] text-muted-foreground">1.00 = usual</span>
            </div>
            {bars.map((v, i) => (
              <div
                key={i}
                className={v >= 1 ? "flex-1 rounded-t-md bg-[#2a78d6]" : "flex-1 rounded-t-md bg-[#2a78d6]/30"}
                style={{ height: `${(v / 1.6) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-xs">
            <div>
              <p className="text-muted-foreground">Baseline</p>
              <p className="mt-0.5 font-medium">Per format</p>
            </div>
            <div>
              <p className="text-muted-foreground">Comments</p>
              <p className="mt-0.5 font-medium">Themes only</p>
            </div>
            <div>
              <p className="text-muted-foreground">Plan</p>
              <p className="mt-0.5 font-medium">Weekly ideas</p>
            </div>
          </div>
        </div>

        <p className="relative text-sm text-white/70">Built for agencies managing Instagram creators.</p>
      </div>
    </div>
  );
}
