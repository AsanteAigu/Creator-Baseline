import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/db/client";
import {
  getCurrentPlan,
  getPlanProgress,
  regeneratePlan,
  replaceUsedSuggestion,
  setSuggestionStatus,
} from "@/lib/services/planService";
import { isRepeat } from "@/lib/services/planTracking";
import { ingestCreator } from "@/lib/services/runService";
import { londonIsoDate } from "@/lib/services/time";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });

let ownerA = "";
let ivyId = "";

beforeAll(async () => {
  const [owner] = await sql<{ id: string }[]>`select id from auth.users where email = 'owner@demo.agency'`;
  ownerA = owner?.id ?? "";
  // Ivy, because the pipeline and security suites own Maya's and Theo's run windows.
  const [ivy] = await sql<{ id: string }[]>`select id from creators where username = 'ivy.interiors'`;
  ivyId = ivy?.id ?? "";
  await ingestCreator(ivyId, { trigger: "manual" });
  if (!ownerA || !ivyId) throw new Error("plan tracking fixtures incomplete");
});

afterAll(async () => {
  await sql.end();
  await closeDb();
});

describe("using an idea (D-047)", () => {
  it("frees its day, writes one new idea for it, and remembers the used one", async () => {
    const plan = await getCurrentPlan(ownerA, ivyId);
    const today = londonIsoDate(new Date());
    // The latest day of the week is never in the past, whichever day the suite runs.
    const target = [...(plan?.suggestions ?? [])]
      .filter((s) => s.suggestedDate !== null && s.suggestedDate >= today)
      .sort((a, b) => (b.suggestedDate ?? "").localeCompare(a.suggestedDate ?? ""))[0];
    if (!target) throw new Error("no idea on a day still to come");

    await setSuggestionStatus(ownerA, target.id, "used");
    const { replacement, note } = await replaceUsedSuggestion(ownerA, target.id);
    expect(note).toBeNull();
    expect(replacement?.suggestedDate).toBe(target.suggestedDate);
    expect(replacement?.status).toBe("proposed");
    expect(isRepeat(replacement?.title ?? "", [target.title])).toBe(false);

    // A second call, as after undo-then-redo, must not stack a second idea on the day.
    const again = await replaceUsedSuggestion(ownerA, target.id);
    expect(again.replacement).toBeNull();
    const onDay = await sql<{ status: string }[]>`
      select status from plan_suggestions where plan_id = ${target.planId} and suggested_date = ${target.suggestedDate}::date
    `;
    expect(onDay.map((r) => r.status).sort()).toEqual(["proposed", "used"]);

    const { tracking, profile } = await getPlanProgress(ownerA, ivyId);
    expect(profile.guidance.length).toBeGreaterThan(0);
    expect(tracking.ideas.map((i) => i.id)).toContain(target.id);

    // A full refresh keeps the used idea and never proposes it again.
    await regeneratePlan(ownerA, ivyId);
    const refreshed = await getCurrentPlan(ownerA, ivyId);
    const active = refreshed?.suggestions.filter((s) => s.status !== "used") ?? [];
    expect(refreshed?.suggestions.find((s) => s.id === target.id)?.status).toBe("used");
    expect(active.some((s) => isRepeat(s.title, [target.title]))).toBe(false);
    expect(active).toHaveLength(7);
  });
});

describe("a manual update with the summary deferred (D-048)", () => {
  it("saves scores and finishes the run first, then writes the summary when the task runs", async () => {
    let task: (() => Promise<void>) | null = null;
    // An hour on, so this run has its own window.
    const now = new Date(Date.now() + 60 * 60 * 1000);
    const result = await ingestCreator(ivyId, { trigger: "manual", now, deferAi: (t) => (task = t) });
    expect(result).toMatchObject({ status: "succeeded", aiPending: true, aiNote: null });
    if (result.status !== "succeeded" || !task) throw new Error("expected a deferred AI task");

    const [run] = await sql<{ status: string }[]>`select status from runs where id = ${result.runId}`;
    expect(run?.status).toBe("succeeded");
    const [before] = await sql<{ n: number }[]>`select count(*)::int as n from comment_insights where run_id = ${result.runId}`;
    expect(before?.n).toBe(0);

    await (task as () => Promise<void>)();
    const [after] = await sql<{ n: number }[]>`select count(*)::int as n from comment_insights where run_id = ${result.runId}`;
    expect(after?.n).toBe(1);
  });
});
