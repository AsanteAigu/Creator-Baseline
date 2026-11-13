import { forbidden, notFound } from "@/lib/errors";
import { createInstagramSource } from "@/lib/instagram/factory";
import { decryptToken } from "@/lib/instagram/crypto";
import { tokenKey } from "@/lib/instagram/keys";
import type { TokenMaterial } from "@/lib/repositories";
import { asSystem, asUser, withRepos } from "@/lib/repositories";
import type { InstagramSource } from "@/lib/instagram/types";

/**
 * Disconnect and deletion are one code path (§11, D-033): both the API and the UI call
 * `deleteCreator`, which removes every creator-owned row in one transaction, records the
 * request before it goes, and revokes the token at Meta afterwards. The audit entry and
 * the deletion record outlive the creator on purpose.
 */

const ORPHAN_AFTER_MS = 30 * 60 * 1000;

export interface DeleteOptions {
  now?: Date;
  /** Injected in tests; production uses the env-selected implementation. */
  source?: InstagramSource;
}

export interface PurgeInput {
  creatorId: string;
  workspaceId: string;
  actorUserId: string | null;
  now?: Date;
  source?: InstagramSource;
  /** Set when the daily job is retrying an existing request. */
  requestId?: string;
}

export async function deleteCreator(userId: string, creatorId: string, opts: DeleteOptions = {}): Promise<void> {
  // RLS hides another workspace's creator, so it is indistinguishable from a missing one.
  const access = await withRepos(asUser(userId), async (r) => {
    const creator = await r.creators.get(creatorId);
    if (!creator) return null;
    const memberships = await r.workspaces.membershipsForUser(userId);
    const role = memberships.find((m) => m.workspaceId === creator.workspaceId)?.role ?? null;
    return { creator, role };
  });
  if (!access) throw notFound("That account");
  if (access.role !== "owner" && access.role !== "admin") {
    throw forbidden("Only owners and admins can disconnect an account.");
  }

  await purgeCreator({
    creatorId: access.creator.id,
    workspaceId: access.creator.workspaceId,
    actorUserId: userId,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
    ...(opts.source !== undefined ? { source: opts.source } : {}),
  });
}

/** System scope; the caller has already checked membership and role. */
export async function purgeCreator(input: PurgeInput): Promise<boolean> {
  const now = input.now ?? new Date();
  const source = input.source ?? createInstagramSource();

  // Read the token before the row disappears; it is needed to revoke at Meta.
  const material = await withRepos(asSystem(), (r) => r.creators.getTokenMaterial(input.creatorId));

  const deleted = await withRepos(asSystem(), async (r) => {
    const requestId =
      input.requestId ?? (await r.workspaces.beginDeletionRequest(input.workspaceId, input.creatorId, now));

    const removed = await r.creators.deletePermanently(input.creatorId);
    await r.workspaces.completeDeletionRequest(requestId, now);
    if (removed) {
      await r.workspaces.recordAudit({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: "creator.deleted",
        subject: input.creatorId,
      });
    }
    return removed;
  });

  if (deleted) await revokeBestEffort(material, source);
  return deleted;
}

async function revokeBestEffort(material: TokenMaterial | null, source: InstagramSource): Promise<void> {
  if (material === null) return;
  const key = tokenKey();
  if (key === null) return;
  try {
    await source.revokeToken(decryptToken(material, key));
  } catch (err) {
    // Class only: Meta's message could echo the token.
    console.error(`[purge] token revocation failed: ${err instanceof Error ? err.name : "unknown"}`);
  }
}

export interface PurgeResult {
  orphansFailed: number;
  deletionsCompleted: number;
}

/**
 * Daily housekeeping (§8). Not a retention policy: the client asked to keep past reports
 * (R7). It stops runs stranded by a crashed invocation and finishes deletion requests that
 * did not complete, so neither can linger silently (D-033).
 */
export async function purgeExpired(now: Date = new Date(), source?: InstagramSource): Promise<PurgeResult> {
  const orphansFailed = await withRepos(asSystem(), (r) =>
    r.runs.failOrphans(new Date(now.getTime() - ORPHAN_AFTER_MS), now),
  );

  const pending = await withRepos(asSystem(), (r) => r.workspaces.pendingDeletionRequests());
  let deletionsCompleted = 0;
  for (const request of pending) {
    await purgeCreator({
      creatorId: request.creatorId,
      workspaceId: request.workspaceId,
      actorUserId: null,
      requestId: request.id,
      now,
      ...(source !== undefined ? { source } : {}),
    });
    deletionsCompleted += 1;
  }

  return { orphansFailed, deletionsCompleted };
}
