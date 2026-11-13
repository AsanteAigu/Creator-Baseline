import { describe, expect, it } from "vitest";
import { MAX_COMMENT_CHARS, sampleComments, sanitiseComment } from "./commentSample";
import { addDaysIso, weekStartLondon, londonIsoDate } from "./time";

describe("comment sanitising", () => {
  it("strips @mentions and links", () => {
    expect(sanitiseComment("@jess_m look www.spam.com/x and https://a.b/c now")).toBe("look and now");
    expect(sanitiseComment("visit example-spam.com today")).toBe("visit today");
  });

  it("caps length at 280 characters", () => {
    expect(sanitiseComment("a".repeat(500))).toHaveLength(MAX_COMMENT_CHARS);
  });

  it("dedupes case-insensitively, drops empties and caps the sample", () => {
    expect(sampleComments(["Love this", "love this", "@only_a_mention", "Nice"])).toEqual(["Love this", "Nice"]);
    const many = Array.from({ length: 500 }, (_, i) => `comment ${i}`);
    expect(sampleComments(many)).toHaveLength(300);
  });
});

describe("London calendar", () => {
  it("finds Monday of the week", () => {
    expect(weekStartLondon(new Date("2026-11-13T12:00:00Z"))).toBe("2026-11-09"); // Friday
    expect(weekStartLondon(new Date("2026-11-09T00:30:00Z"))).toBe("2026-11-09"); // Monday
    expect(weekStartLondon(new Date("2026-11-15T23:30:00Z"))).toBe("2026-11-09"); // Sunday night
  });

  it("uses London local date across BST", () => {
    // 23:30 UTC on 30 June is 00:30 BST on 1 July.
    expect(londonIsoDate(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });

  it("adds days across month ends", () => {
    expect(addDaysIso("2026-11-29", 3)).toBe("2026-12-02");
  });
});
