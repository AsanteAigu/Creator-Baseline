import { createHash, randomBytes } from "node:crypto";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { asSystem, withRepos, type Invite, type InviteRole, type MemberView } from "@/lib/repositories";
import { getWorkspaceContext, type WorkspaceContext } from "./creatorService";

/**
 * People in a workspace (D-040): owners and admins invite by link, the invitee sets their own
 * password. Membership and invite rows are written in system scope, after the checks here,
 * because auth.users emails are not visible through RLS.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const INVITE_ROLES: readonly InviteRole[] = ["admin", "viewer", "creator"];

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

async function requireManager(userId: string): Promise<WorkspaceContext> {
  const context = await getWorkspaceContext(userId);
  if (context.role !== "owner" && context.role !== "admin") {
    throw forbidden("Only owners and admins can manage people.");
  }
  return context;
}

export interface People {
  members: MemberView[];
  invites: Invite[];
}

export async function listPeople(userId: string, now = new Date()): Promise<People> {
  const context = await requireManager(userId);
  return withRepos(asSystem(), async (r) => ({
    members: await r.workspaces.listMembers(context.workspaceId),
    invites: await r.invites.listPending(context.workspaceId, now),
  }));
}

export interface CreatedInvite {
  invite: Invite;
  /** Shown once to the inviter; only its hash is stored. */
  token: string;
}

export async function createInvite(
  userId: string,
  input: { email: string; role: InviteRole },
  now = new Date(),
): Promise<CreatedInvite> {
  const context = await requireManager(userId);
  const email = input.email.trim().toLowerCase();
  const token = newInviteToken();

  return withRepos(asSystem(), async (r) => {
    const members = await r.workspaces.listMembers(context.workspaceId);
    if (members.some((m) => m.email?.toLowerCase() === email)) {
      throw new AppError("CONFLICT", "That person is already in this agency.");
    }
    await r.invites.create({
      workspaceId: context.workspaceId,
      email,
      role: input.role,
      tokenHash: hashInviteToken(token),
      invitedBy: userId,
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    });
    await r.workspaces.recordAudit({
      workspaceId: context.workspaceId,
      actorUserId: userId,
      action: "member.invited",
      subject: null,
      metadata: { role: input.role },
    });
    const invite = (await r.invites.findByTokenHash(hashInviteToken(token)))!;
    return { invite, token };
  });
}

export async function revokeInvite(userId: string, inviteId: string): Promise<void> {
  const context = await requireManager(userId);
  const removed = await withRepos(asSystem(), (r) => r.invites.revoke(context.workspaceId, inviteId));
  if (!removed) throw notFound("That invite");
}

export async function removeMember(userId: string, targetUserId: string): Promise<void> {
  const context = await requireManager(userId);
  if (targetUserId === userId) throw new AppError("CONFLICT", "You can't remove yourself.");
  await withRepos(asSystem(), async (r) => {
    const members = await r.workspaces.listMembers(context.workspaceId);
    const target = members.find((m) => m.userId === targetUserId);
    if (!target) throw notFound("That person");
    if (target.role === "owner") {
      if (context.role !== "owner") throw forbidden("Only an owner can remove an owner.");
      if ((await r.workspaces.countOwners(context.workspaceId)) <= 1) {
        throw new AppError("CONFLICT", "An agency needs at least one owner.");
      }
    }
    await r.workspaces.removeMember(context.workspaceId, targetUserId);
    await r.workspaces.recordAudit({
      workspaceId: context.workspaceId,
      actorUserId: userId,
      action: "member.removed",
      subject: targetUserId,
    });
  });
}

export type InviteStatus = "valid" | "used" | "expired" | "invalid";

export interface InvitePreview {
  status: InviteStatus;
  workspaceName: string | null;
  email: string | null;
  role: InviteRole | null;
}

/** Read without a session: the link itself is the credential, so only its own details show. */
export async function previewInvite(token: string, now = new Date()): Promise<InvitePreview> {
  const invite = await withRepos(asSystem(), (r) => r.invites.findByTokenHash(hashInviteToken(token)));
  if (!invite) return { status: "invalid", workspaceName: null, email: null, role: null };
  const status: InviteStatus = invite.acceptedAt !== null ? "used" : invite.expiresAt <= now ? "expired" : "valid";
  return { status, workspaceName: invite.workspaceName, email: invite.email, role: invite.role };
}

/** Adds the signed-in user to the invite's workspace. The account email must match the invite. */
export async function acceptInvite(
  userId: string,
  userEmail: string | null,
  token: string,
  now = new Date(),
): Promise<void> {
  await withRepos(asSystem(), async (r) => {
    const invite = await r.invites.findByTokenHash(hashInviteToken(token));
    if (!invite || invite.acceptedAt !== null || invite.expiresAt <= now) {
      throw new AppError("CONFLICT", "This invite link has expired or was already used. Ask for a new one.");
    }
    if (userEmail?.toLowerCase() !== invite.email) {
      throw forbidden(`This invite is for ${invite.email}. Sign in with that email to accept it.`);
    }
    if (!(await r.invites.markAccepted(invite.id, userId, now))) {
      throw new AppError("CONFLICT", "This invite link has expired or was already used. Ask for a new one.");
    }
    await r.workspaces.addMember(invite.workspaceId, userId, invite.role);
    await r.workspaces.recordAudit({
      workspaceId: invite.workspaceId,
      actorUserId: userId,
      action: "member.joined",
      subject: null,
      metadata: { role: invite.role },
    });
  });
}
