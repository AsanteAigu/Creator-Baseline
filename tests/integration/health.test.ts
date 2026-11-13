import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/db/client";
import { getHealth } from "@/lib/services/healthService";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });

let ownerId = "";

beforeAll(async () => {
  const [row] = await sql<{ id: string }[]>`select id from auth.users where email = 'owner@demo.agency'`;
  ownerId = row?.id ?? "";
  if (!ownerId) throw new Error("health fixtures incomplete");
});

afterAll(async () => {
  await sql.end();
  await closeDb();
});

describe("GET /api/health report", () => {
  it("reports the build, the migration ledger and every creator in the workspace", async () => {
    const report = await getHealth(ownerId);

    expect(report.build).toBeTruthy();
    expect(report.migrations?.applied).toBeGreaterThanOrEqual(1);
    expect(report.migrations?.latest).toMatch(/^\d{14}_/);
    expect(report.creators.map((c) => c.username).sort()).toEqual([
      "ivy.interiors",
      "maya.cooks.uk",
      "theo.trains",
    ]);
    expect(["ok", "degraded"]).toContain(report.status);
  });

  it("marks a creator degraded once its latest run failed", async () => {
    const [creator] = await sql<{ id: string }[]>`select id from public.creators where username = 'theo.trains'`;
    if (!creator) throw new Error("theo missing");

    const now = new Date();
    const [run] = await sql<{ id: string }[]>`
      insert into public.runs (creator_id, trigger, status, window_start, started_at, finished_at, error_code)
      values (${creator.id}, 'schedule', 'failed', ${now}, ${now}, ${now}, 'INSTAGRAM_UNAVAILABLE')
      returning id
    `;
    if (!run) throw new Error("run insert failed");
    try {
      const report = await getHealth(ownerId);
      expect(report.status).toBe("degraded");
      const theo = report.creators.find((c) => c.username === "theo.trains");
      expect(theo?.lastRun).toMatchObject({ status: "failed", errorCode: "INSTAGRAM_UNAVAILABLE" });
    } finally {
      await sql`delete from public.runs where id = ${run.id}`;
    }
  });
});
