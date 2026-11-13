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
    async getTokenMaterial(id: string): Promise<{ ciphertext: string; iv: string } | null> {
      const [row] = await tx<{ access_token_ciphertext: string | null; token_iv: string | null }[]>`
        select access_token_ciphertext, token_iv from public.creators where id = ${id}
      `;
      if (!row?.access_token_ciphertext || !row.token_iv) return null;
      return { ciphertext: row.access_token_ciphertext, iv: row.token_iv };
    },

    async markSynced(id: string, at: Date): Promise<void> {
      await tx`update public.creators set last_synced_at = ${at} where id = ${id}`;
    },
  };
}
