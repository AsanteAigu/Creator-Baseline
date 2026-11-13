import type { Tx } from "@/lib/db/client";

/**
 * Local-development sign-in against the auth shim (bcrypt via pgcrypto). Supabase projects
 * authenticate through Supabase Auth instead and never call this.
 */
export function authRepo(tx: Tx) {
  return {
    async verifyLocalPassword(email: string, password: string): Promise<{ id: string; email: string } | null> {
      const [row] = await tx<{ id: string; email: string }[]>`
        select id, email from auth.users
        where lower(email) = lower(${email})
          and encrypted_password is not null
          and encrypted_password = crypt(${password}, encrypted_password)
      `;
      return row ?? null;
    },

    async emailFor(userId: string): Promise<string | null> {
      const [row] = await tx<{ email: string | null }[]>`select email from auth.users where id = ${userId}`;
      return row?.email ?? null;
    },
  };
}
