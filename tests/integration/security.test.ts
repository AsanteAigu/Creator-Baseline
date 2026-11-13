import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { getOverview, listCreatorCards, listPosts, requestManualRun } from "@/lib/services/creatorService";
import { getCurrentPlan, setSuggestionStatus } from "@/lib/services/planService";
import { ingestCreator } from "@/lib/services/runService";
import { updateSettings } from "@/lib/services/settingsService";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
const OTHER_WS = "00000000-0000-4000-8000-0000000000b2";

let ownerA = "";
let viewerA = "";
let ownerB = "";
let theoId = "";
let suggestionId = "";

async function expectAppError(p: Promise<unknown>, code: AppError["code"]): Promise<void> {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

beforeAll(async () => {
  const users = await sql<{ id: string; email: string }[]>`
    select id, email from auth.users where email in ('owner@demo.agency', 'viewer@demo.agency')
  `;
  ownerA = users.find((u) => u.email === "owner@demo.agency")?.id ?? "";
  viewerA = users.find((u) => u.email === "viewer@demo.agency")?.id ?? "";

  const [b] = await sql<{ id: string }[]>`
    insert into auth.users (email) values ('owner@other.agency')
    on conflict (email) do update set email = excluded.email returning id
  `;
  ownerB = b?.id ?? "";
  await sql`insert into workspaces (id, name) values (${OTHER_WS}, 'Other Agency') on conflict do nothing`;
  await sql`insert into scoring_settings (workspace_id) values (${OTHER_WS}) on conflict do nothing`;
  await sql`
    insert into workspace_members (workspace_id, user_id, role) values (${OTHER_WS}, ${ownerB}, 'owner')
    on conflict do nothing
  `;

  // Theo, not Maya: the pipeline suite owns Maya's run windows, and two files ingesting
  // the same creator in the same window would make the report counts order-dependent.
  const [theo] = await sql<{ id: string }[]>`select id from creators where username = 'theo.trains'`;
  theoId = theo?.id ?? "";
  await ingestCreator(theoId, { trigger: "manual" });
  const plan = await getCurrentPlan(ownerA, theoId);
  suggestionId = plan?.suggestions[0]?.id ?? "";
  if (!ownerA || !viewerA || !ownerB || !theoId || !suggestionId) throw new Error("security fixtures incomplete");
});

afterAll(async () => {
  await sql.end();
  await closeDb();
});

describe("cross-workspace isolation", () => {
  it("lets a member of A read A's creators", async () => {
    const { cards } = await listCreatorCards(ownerA);
    expect(cards.map((c) => c.creator.username).sort()).toEqual(["ivy.interiors", "maya.cooks.uk", "theo.trains"]);
  });

  it("shows a member of B none of A's creators", async () => {
    const { cards } = await listCreatorCards(ownerB);
    expect(cards).toEqual([]);
  });

  it("refuses B reading A's creator overview, posts or plan, as not found", async () => {
    await expectAppError(getOverview(ownerB, theoId), "NOT_FOUND");
    await expectAppError(listPosts(ownerB, theoId, {}, 10, null), "NOT_FOUND");
    await expectAppError(getCurrentPlan(ownerB, theoId), "NOT_FOUND");
  });

  it("refuses B patching A's suggestion and leaves it unchanged", async () => {
    const [before] = await sql`select status from plan_suggestions where id = ${suggestionId}`;
    await expectAppError(setSuggestionStatus(ownerB, suggestionId, "used"), "NOT_FOUND");
    const [after] = await sql`select status from plan_suggestions where id = ${suggestionId}`;
    expect(after).toEqual(before);
  });

  it("refuses B starting a run on A's creator", async () => {
    await expectAppError(requestManualRun(ownerB, theoId), "NOT_FOUND");
  });

  it("hides token columns from user sessions entirely", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config('role', 'authenticated', true)`;
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerA })}, true)`;
        return tx`select access_token_ciphertext from creators`;
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("roles inside a workspace", () => {
  it("lets a viewer mark a suggestion used, and persists it", async () => {
    const updated = await setSuggestionStatus(viewerA, suggestionId, "used");
    expect(updated.status).toBe("used");
    const [row] = await sql`select status, decided_by from plan_suggestions where id = ${suggestionId}`;
    expect(row).toMatchObject({ status: "used", decided_by: viewerA });
  });

  it("refuses a viewer changing scoring settings or starting a run", async () => {
    await expectAppError(updateSettings(viewerA, { cap: 4 }), "FORBIDDEN");
    await expectAppError(requestManualRun(viewerA, theoId), "FORBIDDEN");
  });

  it("lets an owner change settings and audits it", async () => {
    const updated = await updateSettings(ownerA, { cap: 4.5 });
    expect(updated.cap).toBe(4.5);
    const [audit] = await sql`
      select action, actor_user_id from audit_log where action = 'settings.update' order by created_at desc limit 1
    `;
    expect(audit).toMatchObject({ action: "settings.update", actor_user_id: ownerA });
    await updateSettings(ownerA, { cap: 5 });
  });

  it("rejects a weak cutoff above the strong cutoff", async () => {
    await expectAppError(updateSettings(ownerA, { weakCutoff: 2 }), "VALIDATION_FAILED");
  });
});
