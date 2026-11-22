import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { decryptToken, encryptToken, verifyState } from "@/lib/instagram/crypto";
import { tokenKey, stateKey } from "@/lib/instagram/keys";
import { InstagramError, type ConnectedAccount, type InstagramSource } from "@/lib/instagram/types";
import { beginConnection, completeConnection } from "@/lib/services/connectionService";
import { resolveAccessToken } from "@/lib/services/tokenService";

// Set before the first serverEnv() call; the shared test env has no encryption key.
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
const DAY_MS = 24 * 60 * 60 * 1000;
const IG_USER_ID = "17841400000000001";
const OTHER_IG_USER_ID = "17841400000000002";

let ownerId = "";
let viewerId = "";
let workspaceId = "";
let mayaId = "";
let creatorId = "";

const account = (token: string, igUserId = IG_USER_ID): ConnectedAccount => ({
  token,
  expiresAt: new Date(Date.now() + 60 * DAY_MS),
  igUserId,
  username: "stage.test.creator",
  displayName: "Stage Test Creator",
  avatarUrl: "https://example.test/avatar.jpg",
});

/** Only refreshToken is exercised here; other calls would be a bug in the code under test. */
function fakeSource(
  refresh: (token: string) => Promise<{ token: string; expiresAt: Date }>,
): InstagramSource {
  const unused = (): never => {
    throw new Error("not used by this test");
  };
  return {
    listRecentMedia: unused,
    getMediaInsights: unused,
    listComments: unused,
    authorizationUrl: unused,
    exchangeCode: unused,
    refreshToken: refresh,
    revokeToken: unused,
  };
}

async function expectAppError(p: Promise<unknown>, code: AppError["code"]): Promise<void> {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

async function expectInstagramError(p: Promise<unknown>, code: InstagramError["code"]): Promise<void> {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof InstagramError && e.code === code);
}

async function storedToken(id: string): Promise<string> {
  const [row] = await sql<{ access_token_ciphertext: string; token_iv: string }[]>`
    select access_token_ciphertext, token_iv from creators where id = ${id}
  `;
  if (!row) throw new Error("creator row missing");
  return decryptToken({ ciphertext: row.access_token_ciphertext, iv: row.token_iv }, tokenKey()!);
}

async function status(id: string): Promise<string> {
  const [row] = await sql<{ status: string }[]>`select status from creators where id = ${id}`;
  return row?.status ?? "missing";
}

beforeAll(async () => {
  const users = await sql<{ id: string; email: string }[]>`
    select id, email from auth.users where email in ('owner@demo.agency', 'viewer@demo.agency')
  `;
  ownerId = users.find((u) => u.email === "owner@demo.agency")?.id ?? "";
  viewerId = users.find((u) => u.email === "viewer@demo.agency")?.id ?? "";

  const [membership] = await sql<{ workspace_id: string }[]>`
    select workspace_id from workspace_members where user_id = ${ownerId}
  `;
  workspaceId = membership?.workspace_id ?? "";

  const [maya] = await sql<{ id: string }[]>`select id from creators where username = 'maya.cooks.uk'`;
  mayaId = maya?.id ?? "";

  // A previous interrupted run may have left the test account behind.
  await sql`delete from creators where workspace_id = ${workspaceId} and ig_user_id in (${IG_USER_ID}, ${OTHER_IG_USER_ID})`;

  if (!ownerId || !viewerId || !workspaceId || !mayaId) throw new Error("connection fixtures incomplete");
});

afterAll(async () => {
  await sql`delete from audit_log where workspace_id = ${workspaceId} and subject in (
    select id::text from creators where workspace_id = ${workspaceId} and ig_user_id in (${IG_USER_ID}, ${OTHER_IG_USER_ID})
  )`;
  await sql`delete from creators where workspace_id = ${workspaceId} and ig_user_id in (${IG_USER_ID}, ${OTHER_IG_USER_ID})`;
  await sql.end();
  await closeDb();
});

describe("starting a connection", () => {
  it("refuses a viewer", async () => {
    await expectAppError(beginConnection(viewerId, null), "FORBIDDEN");
  });

  it("signs state carrying the workspace, the user and a nonce", async () => {
    const { nonce, signedState } = await beginConnection(ownerId, null);
    const state = verifyState(signedState, stateKey(), Math.floor(Date.now() / 1000));
    expect(state).toMatchObject({ nonce, userId: ownerId, workspaceId });
    expect(state?.creatorId).toBeUndefined();
  });

  it("carries the creator id when reconnecting", async () => {
    const { signedState } = await beginConnection(ownerId, mayaId);
    const state = verifyState(signedState, stateKey(), Math.floor(Date.now() / 1000));
    expect(state?.creatorId).toBe(mayaId);
  });

  it("refuses a creator that is not visible to the user", async () => {
    await expectAppError(beginConnection(ownerId, "00000000-0000-4000-8000-00000000dead"), "NOT_FOUND");
  });
});

describe("completing a connection", () => {
  it("refuses a viewer", async () => {
    await expectAppError(completeConnection(viewerId, workspaceId, account("viewer-token")), "FORBIDDEN");
  });

  it("stores the token encrypted, activates the creator and audits it", async () => {
    const result = await completeConnection(ownerId, workspaceId, account("first-token"));
    creatorId = result.creatorId;
    expect(creatorId).toMatch(/^[0-9a-f-]{36}$/);

    const [row] = await sql<{
      workspace_id: string;
      ig_user_id: string;
      username: string;
      display_name: string | null;
      status: string;
      access_token_ciphertext: string;
      token_expires_at: Date;
    }[]>`
      select workspace_id, ig_user_id, username, display_name, status,
             access_token_ciphertext, token_expires_at
      from creators where id = ${creatorId}
    `;
    expect(row).toMatchObject({
      workspace_id: workspaceId,
      ig_user_id: IG_USER_ID,
      username: "stage.test.creator",
      display_name: "Stage Test Creator",
      status: "active",
    });
    expect(row?.access_token_ciphertext).not.toContain("first-token");
    expect(await storedToken(creatorId)).toBe("first-token");

    const [audit] = await sql`
      select action, actor_user_id, subject from audit_log
      where action = 'creator.connected' and subject = ${creatorId}
    `;
    expect(audit).toMatchObject({ action: "creator.connected", actor_user_id: ownerId, subject: creatorId });
  });

  it("upserts the same Instagram account instead of creating a duplicate", async () => {
    const again = await completeConnection(ownerId, workspaceId, {
      ...account("second-token"),
      username: "stage.test.renamed",
    });
    expect(again.creatorId).toBe(creatorId);

    const [{ n } = { n: -1 }] = await sql<{ n: number }[]>`
      select count(*)::int as n from creators
      where workspace_id = ${workspaceId} and ig_user_id = ${IG_USER_ID}
    `;
    expect(n).toBe(1);

    const [row] = await sql`select username, status from creators where id = ${creatorId}`;
    expect(row).toMatchObject({ username: "stage.test.renamed", status: "active" });
    expect(await storedToken(creatorId)).toBe("second-token");
  });

  it("refuses a reconnect with a different Instagram account", async () => {
    await expectAppError(
      completeConnection(ownerId, workspaceId, account("other-token", OTHER_IG_USER_ID), creatorId),
      "CONFLICT",
    );
    expect(await storedToken(creatorId)).toBe("second-token");
  });

  it("reconnects the same Instagram account in place", async () => {
    const result = await completeConnection(ownerId, workspaceId, account("third-token"), creatorId);
    expect(result.creatorId).toBe(creatorId);
    expect(await storedToken(creatorId)).toBe("third-token");
    expect(await status(creatorId)).toBe("active");

    const [audit] = await sql`
      select action from audit_log
      where action = 'creator.reconnected' and subject = ${creatorId}
      order by created_at desc limit 1
    `;
    expect(audit).toMatchObject({ action: "creator.reconnected" });
  });

  it("refuses a reconnect to a creator it cannot see", async () => {
    await expectAppError(
      completeConnection(ownerId, workspaceId, account("third-token"), "00000000-0000-4000-8000-00000000dead"),
      "NOT_FOUND",
    );
  });

  it("stores every account shared in one Unified Login, each with the portfolio token (D-044)", async () => {
    const result = await completeConnection(ownerId, workspaceId, {
      ...account("portfolio-token"),
      alsoShared: [{ igUserId: OTHER_IG_USER_ID, username: "second.test.creator", displayName: null, avatarUrl: null }],
    });
    expect(result).toMatchObject({ creatorId, connected: 2 });

    const [other] = await sql<{ id: string; username: string; token_iv: string }[]>`
      select id, username, token_iv from creators where workspace_id = ${workspaceId} and ig_user_id = ${OTHER_IG_USER_ID}
    `;
    expect(other?.username).toBe("second.test.creator");
    expect(await storedToken(other!.id)).toBe("portfolio-token");
    expect(await status(other!.id)).toBe("active");
    const [first] = await sql<{ token_iv: string }[]>`select token_iv from creators where id = ${creatorId}`;
    expect(other?.token_iv).not.toBe(first?.token_iv);
  });
});

describe("resolving a stored token", () => {
  const key = (): Buffer => {
    const k = tokenKey();
    if (k === null) throw new Error("test key missing");
    return k;
  };

  async function setExpiry(token: string, msFromNow: number): Promise<void> {
    const encrypted = encryptToken(token, key());
    await sql`
      update creators set access_token_ciphertext = ${encrypted.ciphertext}, token_iv = ${encrypted.iv},
        token_expires_at = ${new Date(Date.now() + msFromNow)}, status = 'active'
      where id = ${creatorId}
    `;
  }

  it("returns the decrypted token when it is far from expiry", async () => {
    await setExpiry("long-lived-token", 30 * DAY_MS);
    const token = await resolveAccessToken(
      creatorId,
      fakeSource(async () => {
        throw new Error("refresh should not be called");
      }),
      new Date(),
    );
    expect(token).toBe("long-lived-token");
  });

  it("refreshes inside the seven-day window and stores the new token", async () => {
    await setExpiry("old-token", 3 * DAY_MS);
    const newExpiry = new Date(Date.now() + 60 * DAY_MS);
    const token = await resolveAccessToken(
      creatorId,
      fakeSource(async (given) => {
        expect(given).toBe("old-token");
        return { token: "refreshed-token", expiresAt: newExpiry };
      }),
      new Date(),
    );

    expect(token).toBe("refreshed-token");
    expect(await storedToken(creatorId)).toBe("refreshed-token");
    const [row] = await sql<{ token_expires_at: Date; status: string }[]>`
      select token_expires_at, status from creators where id = ${creatorId}
    `;
    expect(row?.status).toBe("active");
    expect(Math.abs((row?.token_expires_at.getTime() ?? 0) - newExpiry.getTime())).toBeLessThan(1000);
  });

  it("keeps a working token when a refresh fails transiently", async () => {
    await setExpiry("still-good-token", 3 * DAY_MS);
    const token = await resolveAccessToken(
      creatorId,
      fakeSource(async () => {
        throw new InstagramError("Instagram returned 503", "UNAVAILABLE", true);
      }),
      new Date(),
    );

    expect(token).toBe("still-good-token");
    expect(await status(creatorId)).toBe("active");
  });

  it("needs reauth when Instagram rejects the refresh", async () => {
    await setExpiry("rejected-token", 3 * DAY_MS);
    await expectInstagramError(
      resolveAccessToken(
        creatorId,
        fakeSource(async () => {
          throw new InstagramError("Invalid OAuth access token", "AUTH", false);
        }),
        new Date(),
      ),
      "AUTH",
    );
    expect(await status(creatorId)).toBe("needs_reauth");
  });

  it("needs reauth when a nearly expired token cannot be refreshed", async () => {
    await setExpiry("almost-dead-token", 60 * 60 * 1000);
    await expectInstagramError(
      resolveAccessToken(
        creatorId,
        fakeSource(async () => {
          throw new InstagramError("Instagram returned 503", "UNAVAILABLE", true);
        }),
        new Date(),
      ),
      "AUTH",
    );
    expect(await status(creatorId)).toBe("needs_reauth");
  });

  it("needs reauth when the stored token cannot be decrypted", async () => {
    const encrypted = encryptToken("secret", key());
    await sql`
      update creators set access_token_ciphertext = ${encrypted.ciphertext}, token_iv = 'not-an-iv',
        status = 'active'
      where id = ${creatorId}
    `;
    await expectInstagramError(
      resolveAccessToken(
        creatorId,
        fakeSource(async () => {
          throw new Error("refresh should not be called");
        }),
        new Date(),
      ),
      "AUTH",
    );
    expect(await status(creatorId)).toBe("needs_reauth");
  });

  it("returns null for a fixture creator with no token in mock mode", async () => {
    const token = await resolveAccessToken(
      mayaId,
      fakeSource(async () => {
        throw new Error("refresh should not be called");
      }),
      new Date(),
    );
    expect(token).toBeNull();
  });
});
