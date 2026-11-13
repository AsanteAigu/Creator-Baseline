import type { Tx } from "@/lib/db/client";

export type CreatorStatus = "active" | "needs_reauth" | "disconnected";

/** Never includes token material: those columns are not selectable by end users anyway. */
export interface Creator {
  id: string;
  workspaceId: string;
  igUserId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: CreatorStatus;
  connectedAt: Date;
  lastSyncedAt: Date | null;
}

/** Encrypted token material plus the profile Instagram gave us at login. */
export interface ConnectionWrite {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  ciphertext: string;
  iv: string;
  expiresAt: Date;
}

export interface TokenMaterial {
  ciphertext: string;
  iv: string;
  expiresAt: Date | null;
}

interface CreatorDbRow {
  id: string;
  workspace_id: string;
  ig_user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: CreatorStatus;
  connected_at: Date;
  last_synced_at: Date | null;
}

function toCreator(r: CreatorDbRow): Creator {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    igUserId: r.ig_user_id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    status: r.status,
    connectedAt: r.connected_at,
    lastSyncedAt: r.last_synced_at,
  };
}

export function creatorsRepo(tx: Tx) {
  return {
    async listForWorkspace(workspaceId: string): Promise<Creator[]> {
      const rows = await tx<CreatorDbRow[]>`
        select id, workspace_id, ig_user_id, username, display_name, avatar_url, status,
               connected_at, last_synced_at
        from public.creators where workspace_id = ${workspaceId}
        order by username
      `;
      return rows.map(toCreator);
    },

    async get(id: string): Promise<Creator | null> {
      const [row] = await tx<CreatorDbRow[]>`
        select id, workspace_id, ig_user_id, username, display_name, avatar_url, status,
               connected_at, last_synced_at
        from public.creators where id = ${id}
      `;
      return row ? toCreator(row) : null;
    },

    /** System scope only (token columns are not granted to end users). */
    async getTokenMaterial(id: string): Promise<TokenMaterial | null> {
      const [row] = await tx<{
        access_token_ciphertext: string | null;
        token_iv: string | null;
        token_expires_at: Date | null;
      }[]>`
        select access_token_ciphertext, token_iv, token_expires_at
        from public.creators where id = ${id}
      `;
      if (!row?.access_token_ciphertext || !row.token_iv) return null;
      return {
        ciphertext: row.access_token_ciphertext,
        iv: row.token_iv,
        expiresAt: row.token_expires_at,
      };
    },

    /**
     * System scope only. A completed OAuth login either creates the creator or updates the
     * existing row for the same Instagram account (reconnecting the same account twice must
     * not hit the unique key). Reconnecting clears `last_synced_at` so the next scheduled
     * run fetches fresh data.
     */
    async upsertConnected(workspaceId: string, igUserId: string, write: ConnectionWrite): Promise<string> {
      const [row] = await tx<{ id: string }[]>`
        insert into public.creators
          (workspace_id, ig_user_id, username, display_name, avatar_url,
           access_token_ciphertext, token_iv, token_expires_at, status, connected_at)
        values
          (${workspaceId}, ${igUserId}, ${write.username}, ${write.displayName}, ${write.avatarUrl},
           ${write.ciphertext}, ${write.iv}, ${write.expiresAt}, 'active', now())
        on conflict (workspace_id, ig_user_id) do update set
          username = excluded.username,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          access_token_ciphertext = excluded.access_token_ciphertext,
          token_iv = excluded.token_iv,
          token_expires_at = excluded.token_expires_at,
          status = 'active',
          last_synced_at = case when creators.status = 'active' then creators.last_synced_at else null end
        returning id
      `;
      if (!row) throw new Error("connected creator was not stored");
      return row.id;
    },

    /** System scope only. Reconnect of an existing creator; false when it does not exist. */
    async updateConnection(id: string, write: ConnectionWrite): Promise<boolean> {
      const rows = await tx<{ id: string }[]>`
        update public.creators set
          username = ${write.username},
          display_name = ${write.displayName},
          avatar_url = ${write.avatarUrl},
          access_token_ciphertext = ${write.ciphertext},
          token_iv = ${write.iv},
          token_expires_at = ${write.expiresAt},
          status = 'active',
          last_synced_at = case when status = 'active' then last_synced_at else null end
        where id = ${id}
        returning id
      `;
      return rows.length > 0;
    },

    /** System scope only: stores a refreshed token without touching the profile. */
    async setToken(id: string, ciphertext: string, iv: string, expiresAt: Date): Promise<void> {
      await tx`
        update public.creators set
          access_token_ciphertext = ${ciphertext},
          token_iv = ${iv},
          token_expires_at = ${expiresAt},
          status = 'active'
        where id = ${id}
      `;
    },

    /** System scope only: `needs_reauth` on a failed refresh or an auth error. */
    async setStatus(id: string, status: CreatorStatus): Promise<void> {
      await tx`update public.creators set status = ${status} where id = ${id}`;
    },

    async markSynced(id: string, at: Date): Promise<void> {
      await tx`update public.creators set last_synced_at = ${at} where id = ${id}`;
    },
  };
}
