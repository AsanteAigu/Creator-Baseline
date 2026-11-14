import { createHmac, timingSafeEqual } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/config";
import { createLocalAccount, localUserEmail, verifyLocalCredentials } from "@/lib/services/authService";

/**
 * Two modes, picked by configuration:
 *  - supabase: Supabase Auth via @supabase/ssr (production);
 *  - local: email + password checked against the local auth shim, session in a signed,
 *    HTTP-only cookie (development without Supabase; refused in production by lib/config).
 * Either way the result is only a verified user id; data access is then gated by RLS.
 */

export interface SessionUser {
  id: string;
  email: string | null;
}

const LOCAL_COOKIE = "cb_session";
const LOCAL_TTL_SECONDS = 7 * 24 * 60 * 60;

export function authMode(): "supabase" | "local" {
  const env = serverEnv();
  return env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "supabase" : "local";
}

async function supabase() {
  const env = serverEnv();
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL ?? "", env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; the next action or route refreshes them.
        }
      },
    },
  });
}

function sign(payload: string): string {
  const secret = serverEnv().SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for local sign-in");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function readLocalToken(token: string | undefined): string | null {
  if (!token) return null;
  const [userId, exp, sig] = token.split(".");
  if (!userId || !exp || !sig) return null;
  const expected = Buffer.from(sign(`${userId}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(exp) * 1000 < Date.now()) return null;
  return userId;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  if (authMode() === "supabase") {
    const { data } = await (await supabase()).auth.getUser();
    return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
  }
  const store = await cookies();
  const userId = readLocalToken(store.get(LOCAL_COOKIE)?.value);
  if (!userId) return null;
  return { id: userId, email: await localUserEmail(userId) };
}

/** Returns the signed-in user's id, or null when the credentials don't match. */
export async function signIn(email: string, password: string): Promise<string | null> {
  if (authMode() === "supabase") {
    const { data, error } = await (await supabase()).auth.signInWithPassword({ email, password });
    return error ? null : (data.user?.id ?? null);
  }
  const user = await verifyLocalCredentials(email, password);
  if (!user) return null;
  await setLocalSession(user.id);
  return user.id;
}

/**
 * New account from an invite link (D-040). Supabase: the public sign-up endpoint, so no
 * service-role key in this request path; it only yields a session when the project has email
 * confirmation switched off. "rejected" covers Supabase's own rules (e.g. a weak password).
 */
export type SignUpResult = "signed_in" | "exists" | "needs_confirmation" | "rejected";

export async function signUp(
  email: string,
  password: string,
): Promise<{ status: SignUpResult; userId: string | null }> {
  if (authMode() === "supabase") {
    const { data, error } = await (await supabase()).auth.signUp({ email, password });
    if (error) return { status: error.code === "user_already_exists" ? "exists" : "rejected", userId: null };
    return data.session
      ? { status: "signed_in", userId: data.user?.id ?? null }
      : { status: "needs_confirmation", userId: null };
  }
  const user = await createLocalAccount(email, password);
  if (!user) return { status: "exists", userId: null };
  await setLocalSession(user.id);
  return { status: "signed_in", userId: user.id };
}

async function setLocalSession(userId: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + LOCAL_TTL_SECONDS;
  const payload = `${userId}.${exp}`;
  (await cookies()).set(LOCAL_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: serverEnv().NODE_ENV === "production",
    path: "/",
    maxAge: LOCAL_TTL_SECONDS,
  });
}

export async function signOut(): Promise<void> {
  if (authMode() === "supabase") {
    await (await supabase()).auth.signOut();
    return;
  }
  (await cookies()).delete(LOCAL_COOKIE);
}
