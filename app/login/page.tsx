import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { PRODUCT_NAME } from "@/lib/config";
import { LoginForm } from "./login-form";

export const metadata = { title: `Sign in · ${PRODUCT_NAME}` };

// Reads the session cookie: never prerender this page at build time.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/dashboard");
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-page px-4 py-10">
      {/* Decorative baseline motif: faint grid with one rising line, drawn in SVG. */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 1200 800">
        <defs>
          <pattern id="login-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0H0V48" fill="none" stroke="var(--chart-grid)" strokeWidth="1" />
          </pattern>
          <linearGradient id="login-fade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--page)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--page)" stopOpacity="1" />
          </linearGradient>
        </defs>
        <rect width="1200" height="800" fill="url(#login-grid)" />
        <line x1="0" x2="1200" y1="520" y2="520" stroke="var(--chart-muted)" strokeOpacity="0.35" strokeDasharray="6 8" />
        <path d="M0 600 L180 560 L320 590 L470 500 L610 540 L760 430 L900 470 L1050 340 L1200 300" fill="none" stroke="var(--chart-1)" strokeOpacity="0.35" strokeWidth="2.5" strokeLinejoin="round" />
        <rect width="1200" height="800" fill="url(#login-fade)" />
      </svg>

      <div className="relative flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-11" />
          <div>
            <p className="text-lg font-semibold tracking-tight">{PRODUCT_NAME}</p>
            <p className="text-sm text-muted-foreground">Every post, measured against the creator&apos;s own usual.</p>
          </div>
        </div>
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>New here? Open the invite link your agency sent you.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
