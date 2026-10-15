import { describe, expect, it } from "vitest";
import { freshness } from "./staleness.ts";

describe("freshness", () => {
  const now = 1_000_000;

  it("is fresh while the age is within the threshold", () => {
    expect(freshness(now, now - 120, 1000)).toEqual({
      kind: "fresh",
      ageMs: 120,
      label: "Fresh · 120 ms",
    });
    expect(freshness(now, now - 1000, 1000).kind).toBe("fresh");
  });

  it("is stale past the threshold, with the age in the label", () => {
    expect(freshness(now, now - 1200, 1000)).toEqual({
      kind: "stale",
      ageMs: 1200,
      label: "Data 1.2 s old",
    });
    expect(freshness(now, now - 95_000, 1000).label).toBe("Data 1 min 35 s old");
  });

  it("judges the real age, not the rounded label", () => {
    // 1.29 s shows as 1.2 s (truncated, like a clock), but 1.29 > 1.25 is stale.
    expect(freshness(now, now - 1290, 1250)).toMatchObject({
      kind: "stale",
      label: "Data 1.2 s old",
    });
  });

  it("reports no data before the first message", () => {
    expect(freshness(now, null, 1000).kind).toBe("none");
    expect(freshness(now, 0, 1000).kind).toBe("none");
  });

  it("treats a clock that went backwards as age 0, not negative", () => {
    expect(freshness(now, now + 50, 1000)).toMatchObject({ kind: "fresh", ageMs: 0 });
  });
});
