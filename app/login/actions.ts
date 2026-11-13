"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimit";

export interface LoginState {
  error: string | null;
  email: string;
}

const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export async function signInAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  const email = typeof form.get("email") === "string" ? String(form.get("email")) : "";
  if (!parsed.success) return { error: "Enter your email address and password.", email };

  try {
    await enforceRateLimit(`login:${parsed.data.email.toLowerCase()}`, 10, 900);
  } catch (err) {
    if (err instanceof AppError) return { error: "Too many attempts. Please wait 15 minutes and try again.", email };
    throw err;
  }

  const ok = await signIn(parsed.data.email, parsed.data.password);
  // Same message for unknown email and wrong password: don't reveal which accounts exist.
  if (!ok) return { error: "That email and password don't match. Check them and try again.", email };
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/login");
}
