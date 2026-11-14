import type { Tx } from "@/lib/db/client";
import type { Role } from "./workspaces";

export type InviteRole = Exclude<Role, "owner">;

export interface Invite {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: InviteRole;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
}

interface InviteDbRow {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  role: InviteRole;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
}

const toInvite = (r: InviteDbRow): Invite => ({
  id: r.id,
  workspaceId: r.workspace_id,
  workspaceName: r.name,
  email: r.email,
  role: r.role,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  acceptedAt: r.accepted_at,
});

/** Invite links (D-040). Writes run in system scope after the service's role check. */
export function invitesRepo(tx: Tx) {
  return {
    async create(input: {
      workspaceId: string;
      email: string;
      role: InviteRole;
      tokenHash: string;
      invitedBy: string;
      expiresAt: Date;
    }): Promise<string> {
      const [row] = await tx<{ id: string }[]>`
        insert into public.workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
        values (${input.workspaceId}, ${input.email}, ${input.role}, ${input.tokenHash}, ${input.invitedBy}, ${input.expiresAt})
        returning id
      `;
      if (!row) throw new Error("invite was not stored");
      return row.id;
    },

    async listPending(workspaceId: string, now: Date): Promise<Invite[]> {
      const rows = await tx<InviteDbRow[]>`
        select i.id, i.workspace_id, w.name, i.email, i.role, i.created_at, i.expires_at, i.accepted_at
        from public.workspace_invites i
        join public.workspaces w on w.id = i.workspace_id
        where i.workspace_id = ${workspaceId} and i.accepted_at is null and i.expires_at > ${now}
        order by i.created_at desc
      `;
      return rows.map(toInvite);
    },

    async findByTokenHash(tokenHash: string): Promise<Invite | null> {
      const [row] = await tx<InviteDbRow[]>`
        select i.id, i.workspace_id, w.name, i.email, i.role, i.created_at, i.expires_at, i.accepted_at
        from public.workspace_invites i
        join public.workspaces w on w.id = i.workspace_id
        where i.token_hash = ${tokenHash}
      `;
      return row ? toInvite(row) : null;
    },

    /** Single use: only the first caller to mark it wins. */
    async markAccepted(id: string, userId: string, now: Date): Promise<boolean> {
      const rows = await tx`
        update public.workspace_invites set accepted_at = ${now}, accepted_by = ${userId}
        where id = ${id} and accepted_at is null and expires_at > ${now}
      `;
      return rows.count > 0;
    },

    async revoke(workspaceId: string, id: string): Promise<boolean> {
      const rows = await tx`
        delete from public.workspace_invites
        where id = ${id} and workspace_id = ${workspaceId} and accepted_at is null
      `;
      return rows.count > 0;
    },
  };
}
