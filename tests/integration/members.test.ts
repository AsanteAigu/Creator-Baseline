import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { beginConnection, completeConnection } from "@/lib/services/connectionService";
import { getOverview, listCreatorCards } from "@/lib/services/creatorService";
import { getHealth } from "@/lib/services/healthService";
import {
  acceptInvite,
  createInvite,
  listPeople,
  previewInvite,
  removeMember,
  revokeInvite,
} from "@/lib/services/memberService";

// Set before the first serverEnv() call; connecting encrypts a token.
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
const CREATOR_EMAIL = "theo.login@creator.test";
const SECOND_CREATOR_EMAIL = "new.creator@creator.test";

let ownerId = "";
let viewerId = "";
let workspaceId = "";
let theoId = "";
let mayaId = "";
let creatorUserId = "";

async function expectAppError(p: Promise<unknown>, code: AppError["code"]): Promise<void> {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

async function localUser(email: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into auth.users (email) values (${email})
    on conflict (email) do update set email = excluded.email returning id
  `;
  return row?.id ?? "";
}

beforeAll(async () => {
  const users = await sql<{ id: string; email: string }[]>`
    select id, email from auth.users where email in ('owner@demo.agency', 'viewer@demo.agency')
  `;
  ownerId = users.find((u) => u.email === "owner@demo.agency")?.id ?? "";
  viewerId = users.find((u) => u.email === "viewer@demo.agency")?.id ?? "";
  const [ws] = await sql<
    { workspace_id: string }[]
  >`select workspace_id from workspace_members where user_id = ${ownerId}`;
  workspaceId = ws?.workspace_id ?? "";
  const creators = await sql<{ id: string; username: string }[]>`select id, username from creators`;
  theoId = creators.find((c) => c.username === "theo.trains")?.id ?? "";
  mayaId = creators.find((c) => c.username === "maya.cooks.uk")?.id ?? "";
  creatorUserId = await localUser(CREATOR_EMAIL);
  if (!ownerId || !viewerId || !workspaceId || !theoId || !mayaId || !creatorUserId) {
    throw new Error("member fixtures incomplete");
  }
});

afterAll(async () => {
  // Other suites count the seeded creators; leave the workspace as the seed made it.
  await sql`delete from creators where username = 'new.creator'`;
  await sql.end();
  await closeDb();
});

describe("invite links", () => {
  it("lets only owners and admins invite", async () => {
    await expectAppError(createInvite(viewerId, { email: "x@test.example", role: "viewer" }), "FORBIDDEN");
  });

  it("stores only a hash of the token, and the link joins the invited email once", async () => {
    const { invite, token } = await createInvite(ownerId, { email: CREATOR_EMAIL.toUpperCase(), role: "creator" });
    expect(invite.email).toBe(CREATOR_EMAIL);
    const [stored] = await sql<
      { token_hash: string }[]
    >`select token_hash from workspace_invites where id = ${invite.id}`;
    expect(stored?.token_hash).not.toContain(token);
    expect(await previewInvite(token)).toMatchObject({ status: "valid", email: CREATOR_EMAIL, role: "creator" });

    await expectAppError(acceptInvite(viewerId, "viewer@demo.agency", token), "FORBIDDEN");
    await acceptInvite(creatorUserId, CREATOR_EMAIL, token);
    const [m] = await sql`select role, creator_id from workspace_members where user_id = ${creatorUserId}`;
    expect(m).toMatchObject({ role: "creator", creator_id: null });

    expect((await previewInvite(token)).status).toBe("used");
    await expectAppError(acceptInvite(creatorUserId, CREATOR_EMAIL, token), "CONFLICT");
  });

  it("refuses an expired link and a revoked one", async () => {
    const expired = await createInvite(
      ownerId,
      { email: "late@test.example", role: "viewer" },
      new Date(Date.now() - 8 * 86_400_000),
    );
    expect((await previewInvite(expired.token)).status).toBe("expired");
    await expectAppError(acceptInvite(viewerId, "late@test.example", expired.token), "CONFLICT");

    const revoked = await createInvite(ownerId, { email: "gone@test.example", role: "viewer" });
    await revokeInvite(ownerId, revoked.invite.id);
    expect((await previewInvite(revoked.token)).status).toBe("invalid");
  });

  it("refuses inviting someone who is already a member", async () => {
    await expectAppError(createInvite(ownerId, { email: "viewer@demo.agency", role: "viewer" }), "CONFLICT");
  });
});

describe("creator logins see only their own account (D-011)", () => {
  it("shows a creator with no connected account nothing at all", async () => {
    const { cards } = await listCreatorCards(creatorUserId);
    expect(cards).toEqual([]);
  });

  it("shows a linked creator only their account, and hides the others as not found", async () => {
    await sql`update workspace_members set creator_id = ${theoId} where user_id = ${creatorUserId}`;
    const { cards } = await listCreatorCards(creatorUserId);
    expect(cards.map((c) => c.creator.id)).toEqual([theoId]);
    await expect(getOverview(creatorUserId, theoId)).resolves.toMatchObject({ creator: { id: theoId } });
    await expectAppError(getOverview(creatorUserId, mayaId), "NOT_FOUND");
  });

  it("keeps staff-only views from creators", async () => {
    await expectAppError(getHealth(creatorUserId), "FORBIDDEN");
    await expectAppError(listPeople(creatorUserId), "FORBIDDEN");
    const rows = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: creatorUserId, role: "authenticated" })}, true)`;
      await tx`set local role authenticated`;
      return tx<{ user_id: string }[]>`select user_id from workspace_members`;
    });
    expect(rows.map((r) => r.user_id)).toEqual([creatorUserId]);
  });

  it("lets a linked creator reconnect only their own account", async () => {
    await expect(beginConnection(creatorUserId, theoId)).resolves.toHaveProperty("nonce");
    await expectAppError(beginConnection(creatorUserId, mayaId), "FORBIDDEN");
    await expectAppError(beginConnection(creatorUserId, null), "FORBIDDEN");
  });

  it("links a new creator login to the account it connects", async () => {
    const { token } = await createInvite(ownerId, { email: SECOND_CREATOR_EMAIL, role: "creator" });
    const newUser = await localUser(SECOND_CREATOR_EMAIL);
    await acceptInvite(newUser, SECOND_CREATOR_EMAIL, token);
    await expect(beginConnection(newUser, null)).resolves.toHaveProperty("nonce");

    const { creatorId } = await completeConnection(newUser, workspaceId, {
      token: "creator-own-token",
      expiresAt: null,
      igUserId: "17841400000000555",
      username: "new.creator",
      displayName: "New Creator",
      avatarUrl: null,
    });
    const [m] = await sql`select creator_id from workspace_members where user_id = ${newUser}`;
    expect(m?.creator_id).toBe(creatorId);
    const { cards } = await listCreatorCards(newUser);
    expect(cards.map((c) => c.creator.username)).toEqual(["new.creator"]);
    // Staff still see every account, including the new one.
    const staff = await listCreatorCards(ownerId);
    expect(staff.cards.map((c) => c.creator.username)).toContain("new.creator");
  });
});

describe("removing people", () => {
  it("refuses removing yourself or the last owner, and removes a creator's access", async () => {
    await expectAppError(removeMember(ownerId, ownerId), "CONFLICT");
    await removeMember(ownerId, creatorUserId);
    await expectAppError(listCreatorCards(creatorUserId), "FORBIDDEN");
  });
});
