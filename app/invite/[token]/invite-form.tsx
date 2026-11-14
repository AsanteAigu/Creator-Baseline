"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { acceptInviteAction, type InviteState } from "./actions";

export function InviteForm({ token, email, signedIn }: { token: string; email: string; signedIn: boolean }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(acceptInviteAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} readOnly autoComplete="username" />
      </div>
      {signedIn ? null : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Choose a password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
            <p className="text-xs text-muted-foreground">
              At least 8 characters. If you already have an account with this email, enter its password instead.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm">Repeat password</Label>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
          </div>
        </>
      )}
      {state.error ? (
        <p role="alert" className="text-sm text-[#9f1f1f]">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Accept invite"}
      </Button>
    </form>
  );
}
