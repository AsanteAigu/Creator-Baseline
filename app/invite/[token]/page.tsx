import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { PRODUCT_NAME } from "@/lib/config";
import { previewInvite } from "@/lib/services/memberService";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Join", robots: { index: false } };

// Reads the session cookie and live invite state: never prerender.
export const dynamic = "force-dynamic";

const ROLE_TEXT: Record<string, string> = {
  admin: "as an admin",
  viewer: "as a viewer",
  creator: "as a creator. You'll connect your own Instagram and see only your account",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = token.length >= 20 && token.length <= 200 ? await previewInvite(token) : null;
  const user = await getSessionUser();

  const body =
    invite === null || invite.status === "invalid" ? (
      <CardHeader>
        <CardTitle>This invite link doesn&apos;t work</CardTitle>
        <CardDescription>Check you copied the whole link, or ask for a new one.</CardDescription>
      </CardHeader>
    ) : invite.status !== "valid" ? (
      <CardHeader>
        <CardTitle>{invite.status === "used" ? "This invite was already used" : "This invite has expired"}</CardTitle>
        <CardDescription>
          {invite.status === "used" ? (
            <>
              If it was you, <Link href="/login" className="underline">sign in</Link>. Otherwise ask for a new link.
            </>
          ) : (
            "Ask the person who invited you for a new link."
          )}
        </CardDescription>
      </CardHeader>
    ) : (
      <>
        <CardHeader>
          <CardTitle>Join {invite.workspaceName}</CardTitle>
          <CardDescription>You&apos;ve been invited {ROLE_TEXT[invite.role ?? ""] ?? ""}.</CardDescription>
        </CardHeader>
        <CardContent>
          <InviteForm
            token={token}
            email={invite.email ?? ""}
            signedIn={user !== null && user.email?.toLowerCase() === invite.email}
          />
        </CardContent>
      </>
    );

  return (
    <main className="surface-gradient flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2.5 font-display text-lg font-semibold tracking-tight">
          <BrandMark className="size-9" />
          {PRODUCT_NAME}
        </div>
        <Card className="shadow-lift">{body}</Card>
      </div>
    </main>
  );
}
