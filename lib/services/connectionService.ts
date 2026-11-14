import { AppError, forbidden, notFound } from "@/lib/errors";
import {
  encryptToken,
  newNonce,
  signState,
  type OAuthState,
} from "@/lib/instagram/crypto";
import { stateKey, tokenKey } from "@/lib/instagram/keys";
import type { ConnectedAccount } from "@/lib/instagram/types";
import {
  asSystem,
  asUser,
  withRepos,
  type ConnectionWrite,
  type Role,
} from "@/lib/repositories";
import { getWorkspaceContext } from "./creatorService";

/** Cookie-sized and short-lived; the nonce is echoed to Meta, the rest stays server-side. */
const STATE_TTL_SECONDS = 10 * 60;

function canManage(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Staff connect any account. A creator login (D-011) may connect once, to bring in their own
 * Instagram, and afterwards only reconnect that same account.
 */
function canConnect(m: { role: Role; creatorId: string | null }, creatorId: string | null): boolean {
  if (canManage(m.role)) return true;
  if (m.role !== "creator") return false;
  return creatorId === null ? m.creatorId === null : creatorId === m.creatorId;
}

const CANNOT_CONNECT = "Only owners and admins can connect accounts.";

export interface StartedConnection {
  /** Echoed back by Meta as `state`. */
  nonce: string;
  /** Signed payload for the HTTP-only cookie. */
  signedState: string;
}

/**
 * Starts a Facebook Login for Business flow for the signed-in user's workspace. The state
 * cookie carries the tenant, so the callback never trusts a workspace id from the URL.
 */
export async function beginConnection(userId: string, creatorId: string | null): Promise<StartedConnection> {
  const context = await getWorkspaceContext(userId);
  if (!canConnect(context, creatorId)) throw forbidden(CANNOT_CONNECT);
  if (creatorId !== null) {
    // RLS: a creator from another workspace is indistinguishable from a missing one.
    const creator = await withRepos(asUser(userId), (r) => r.creators.get(creatorId));
    if (!creator) throw notFound("That account");
  }

  const nonce = newNonce();
  const state: OAuthState = {
    nonce,
    userId,
    workspaceId: context.workspaceId,
    ...(creatorId !== null ? { creatorId } : {}),
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  };
  return { nonce, signedState: signState(state, stateKey()) };
}

export interface CompletedConnection {
  creatorId: string;
}

/**
 * Stores a completed login. New accounts are inserted; a reconnect updates the creator the
 * user started from and must be the same Instagram account (D-029).
 */
export async function completeConnection(
  actorUserId: string,
  workspaceId: string,
  account: ConnectedAccount,
  existingCreatorId?: string,
): Promise<CompletedConnection> {
  const membership = await requireConnector(actorUserId, workspaceId, existingCreatorId ?? null);

  const key = tokenKey();
  if (key === null) throw new Error("TOKEN_ENCRYPTION_KEY is required to connect accounts");
  const encrypted = encryptToken(account.token, key);
  const write: ConnectionWrite = {
    username: account.username,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    expiresAt: account.expiresAt,
  };

  if (existingCreatorId !== undefined) {
    const existing = await withRepos(asSystem(), (r) => r.creators.get(existingCreatorId));
    if (!existing || existing.workspaceId !== workspaceId) throw notFound("That account");
    if (existing.igUserId !== account.igUserId) {
      throw new AppError(
        "CONFLICT",
        "That Facebook login belongs to a different Instagram account. Use “Connect account” to add it as a new creator.",
      );
    }
    const updated = await withRepos(asSystem(), (r) =>
      r.creators.updateConnection(existingCreatorId, write),
    );
    if (!updated) throw notFound("That account");
    await audit(workspaceId, actorUserId, "creator.reconnected", existingCreatorId);
    return { creatorId: existingCreatorId };
  }

  const creatorId = await withRepos(asSystem(), (r) =>
    r.creators.upsertConnected(workspaceId, account.igUserId, write),
  );
  if (membership.role === "creator") {
    await withRepos(asSystem(), (r) => r.workspaces.linkCreator(workspaceId, actorUserId, creatorId));
  }
  await audit(workspaceId, actorUserId, "creator.connected", creatorId);
  return { creatorId };
}

/**
 * The callback runs after a top-level redirect, so the session cookie may have expired
 * mid-flow. The signed state proves who started it; membership is re-checked here.
 */
async function requireConnector(
  userId: string,
  workspaceId: string,
  creatorId: string | null,
): Promise<{ role: Role; creatorId: string | null }> {
  const memberships = await withRepos(asSystem(), (r) => r.workspaces.membershipsForUser(userId));
  const membership = memberships.find((m) => m.workspaceId === workspaceId);
  if (!membership) throw forbidden("You no longer have access to this agency.");
  if (!canConnect(membership, creatorId)) throw forbidden(CANNOT_CONNECT);
  return membership;
}

async function audit(
  workspaceId: string,
  actorUserId: string,
  action: string,
  creatorId: string,
): Promise<void> {
  // Subject is the creator id only: no username, token or profile data goes to the log.
  await withRepos(asSystem(), (r) =>
    r.workspaces.recordAudit({ workspaceId, actorUserId, action, subject: creatorId }),
  );
}
