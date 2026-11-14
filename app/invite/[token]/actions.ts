"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser, signIn, signUp } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimit";
import { acceptInvite, hashInviteToken, previewInvite } from "@/lib/services/memberService";

export interface InviteState {
  error: string | null;
}

const MIN_PASSWORD = 8;

const input = z.object({
  token: z.string().min(20).max(200),
  password: z.string().max(200).optional(),
  confirm: z.string().max(200).optional(),
});

/**
 * Accepts an invite link (D-040). Signed in with the invited email: join straight away.
 * Otherwise create the account with the password typed here, or, if the email already has an
 * account, sign in with it, then join.
 */
export async function acceptInviteAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const parsed = input.safeParse({
    token: form.get("token"),
    password: form.get("password") ?? undefined,
    confirm: form.get("confirm") ?? undefined,
  });
  if (!parsed.success) return { error: "This invite link looks incomplete. Open it again from the message you were sent." };
  const { token, password, confirm } = parsed.data;

  try {
    // Keyed on the link, not the person: the link is the credential being guessed at.
    await enforceRateLimit(`invite-accept:${hashInviteToken(token).slice(0, 32)}`, 10, 900);
  } catch (err) {
    if (err instanceof AppError) return { error: "Too many attempts. Please wait 15 minutes and try again." };
    throw err;
  }

  const preview = await previewInvite(token);
  if (preview.status !== "valid" || preview.email === null) {
    return { error: "This invite link has expired or was already used. Ask for a new one." };
  }
  const email = preview.email;

  let userId: string | null = null;
  const current = await getSessionUser();
  if (current) {
    if (current.email?.toLowerCase() !== email) {
      return { error: `You're signed in as ${current.email ?? "another account"}. Sign out, then open this link again.` };
    }
    userId = current.id;
  } else {
    if (!password || password.length < MIN_PASSWORD) {
      return { error: `Choose a password of at least ${MIN_PASSWORD} characters.` };
    }
    if (confirm !== undefined && confirm !== password) return { error: "The two passwords don't match." };

    const created = await signUp(email, password);
    if (created.status === "signed_in") {
      userId = created.userId;
    } else if (created.status === "exists") {
      userId = await signIn(email, password);
      if (userId === null) {
        return { error: "You already have an account with this email. Enter that account's password." };
      }
    } else if (created.status === "needs_confirmation") {
      return {
        error:
          "Your account needs email confirmation before it can be used. Ask your agency admin to switch off email confirmation in Supabase, then try again.",
      };
    } else {
      return { error: `That password wasn't accepted. Use at least ${MIN_PASSWORD} characters, mixing letters and numbers.` };
    }
  }
  if (userId === null) return { error: "Something went wrong. Please try again." };

  try {
    await acceptInvite(userId, email, token);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
  redirect("/dashboard");
}
