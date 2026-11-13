import { redirect } from "next/navigation";
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
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4">
      <p className="text-center text-lg font-semibold tracking-tight">{PRODUCT_NAME}</p>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Accounts are created by your agency admin. There is no self sign-up.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
