import { createHmac, timingSafeEqual } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/config";
import { localUserEmail, verifyLocalCredentials } from "@/lib/services/authService";

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

export async function signIn(email: string, password: string): Promise<boolean> {
  if (authMode() === "supabase") {
    const { error } = await (await supabase()).auth.signInWithPassword({ email, password });
    return !error;
  }
  const user = await verifyLocalCredentials(email, password);
  if (!user) return false;
  const exp = Math.floor(Date.now() / 1000) + LOCAL_TTL_SECONDS;
  const payload = `${user.id}.${exp}`;
  (await cookies()).set(LOCAL_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: serverEnv().NODE_ENV === "production",
    path: "/",
    maxAge: LOCAL_TTL_SECONDS,
  });
  return true;
}

export async function signOut(): Promise<void> {
  if (authMode() === "supabase") {
    await (await supabase()).auth.signOut();
    return;
  }
  (await cookies()).delete(LOCAL_COOKIE);
}
