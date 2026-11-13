import { describe, expect, it } from "vitest";
import { isDueForSync } from "./scheduleService";

const NOW = new Date("2026-11-13T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS);

describe("isDueForSync", () => {
  it("is due when the creator has never synced", () => {
    expect(isDueForSync(null, "6 hours", NOW)).toBe(true);
  });

  it("is not due inside the workspace interval", () => {
    expect(isDueForSync(ago(5), "6 hours", NOW)).toBe(false);
  });

  it("is due exactly at the interval boundary", () => {
    expect(isDueForSync(ago(6), "6 hours", NOW)).toBe(true);
  });

  it("honours every interval the settings allow", () => {
    expect(isDueForSync(ago(1), "1 hour", NOW)).toBe(true);
    expect(isDueForSync(ago(2), "3 hours", NOW)).toBe(false);
    expect(isDueForSync(ago(3), "3 hours", NOW)).toBe(true);
    expect(isDueForSync(ago(12), "12 hours", NOW)).toBe(true);
    expect(isDueForSync(ago(23), "24 hours", NOW)).toBe(false);
    expect(isDueForSync(ago(24), "24 hours", NOW)).toBe(true);
  });

  it("falls back to six hours for an unknown interval", () => {
    expect(isDueForSync(ago(5), "weekly", NOW)).toBe(false);
    expect(isDueForSync(ago(6), "weekly", NOW)).toBe(true);
  });
});
