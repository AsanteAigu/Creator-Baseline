import { asSystem, withRepos } from "@/lib/repositories";

/**
 * Local-development credential check (no Supabase configured). Runs in system scope because
 * it *is* the authentication step: there is no user yet to scope the query to.
 */
export async function verifyLocalCredentials(
  email: string,
  password: string,
): Promise<{ id: string; email: string } | null> {
  return withRepos(asSystem(), (r) => r.auth.verifyLocalPassword(email, password));
}

export async function localUserEmail(userId: string): Promise<string | null> {
  return withRepos(asSystem(), (r) => r.auth.emailFor(userId));
}
