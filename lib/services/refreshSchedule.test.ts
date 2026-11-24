import { describe, expect, it } from "vitest";
import { insightsDue } from "./refreshSchedule";

const NOW = new Date("2026-11-24T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("insightsDue", () => {
  it("always reads a post with no reading yet", () => {
    expect(insightsDue(ago(5 * DAY), null, NOW)).toBe("fetch");
    expect(insightsDue(ago(200 * DAY), null, NOW)).toBe("backfill");
  });

  it("re-reads a new post every run", () => {
    expect(insightsDue(ago(10 * HOUR), ago(1 * HOUR), NOW)).toBe("fetch");
  });

  it("spaces readings out as a post ages", () => {
    expect(insightsDue(ago(4 * DAY), ago(2 * HOUR), NOW)).toBe("skip");
    expect(insightsDue(ago(4 * DAY), ago(4 * HOUR), NOW)).toBe("fetch");
    expect(insightsDue(ago(20 * DAY), ago(6 * HOUR), NOW)).toBe("skip");
    expect(insightsDue(ago(20 * DAY), ago(13 * HOUR), NOW)).toBe("fetch");
    expect(insightsDue(ago(90 * DAY), ago(30 * HOUR), NOW)).toBe("skip");
    expect(insightsDue(ago(90 * DAY), ago(49 * HOUR), NOW)).toBe("fetch");
  });

  it("leaves an old post alone once read", () => {
    expect(insightsDue(ago(200 * DAY), ago(300 * DAY), NOW)).toBe("skip");
  });
});
