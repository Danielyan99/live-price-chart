import { describe, expect, it } from "vitest";
import { formatFixed, formatTimeUTC } from "./format.ts";
import { formatTimeTick, niceStep, priceTicks, timeTicks, TIME_STEPS } from "./ticks.ts";
import { Rng } from "./rng.ts";

describe("niceStep", () => {
  it("rounds up to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceStep(3.6)).toEqual({ step: 5, decimals: 0 });
    expect(niceStep(0.22)).toEqual({ step: 0.25, decimals: 2 });
    expect(niceStep(18)).toEqual({ step: 20, decimals: 0 });
    expect(niceStep(21)).toEqual({ step: 25, decimals: 0 });
    expect(niceStep(7)).toEqual({ step: 10, decimals: 0 });
    expect(niceStep(0.003)).toEqual({ step: 0.005, decimals: 3 });
    expect(niceStep(2.5)).toEqual({ step: 2.5, decimals: 1 });
  });

  it("keeps exact powers of ten", () => {
    expect(niceStep(100).step).toBe(100);
    expect(niceStep(0.1).step).toBe(0.1);
    expect(niceStep(1000).step).toBe(1000);
  });
});

describe("priceTicks", () => {
  it("gives round BTC prices inside the range", () => {
    const t = priceTicks(82340.12, 82361.77, 6);
    expect(t.step).toBe(5);
    expect(t.values).toEqual([82345, 82350, 82355, 82360]);
  });

  it("never goes finer than the price increment", () => {
    const t = priceTicks(100.001, 100.004, 10, 0.01);
    expect(t.step).toBe(0.01);
    expect(t.decimals).toBe(2);
    // No cent fits strictly inside (100.001, 100.004): no fake ticks.
    expect(t.values).toEqual([]);
  });

  it("produces exact values (no 0.30000000000000004)", () => {
    const t = priceTicks(0.05, 0.95, 10);
    expect(t.values).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
  });

  it("never prints two ticks with the same label, over many random ranges", () => {
    const rng = new Rng(11);
    for (let i = 0; i < 2000; i++) {
      const min = 1 + rng.next() * 100_000;
      const span = 10 ** (rng.next() * 6 - 2); // 0.01 .. 10_000
      const max = min + span;
      const count = 2 + Math.floor(rng.next() * 10);
      const t = priceTicks(min, max, count);
      const labels = t.values.map((v) => formatFixed(v, t.decimals));
      expect(new Set(labels).size).toBe(labels.length);
      expect(t.values.length).toBeLessThanOrEqual(count + 1);
      for (const [k, v] of t.values.entries()) {
        expect(v).toBeGreaterThanOrEqual(min - t.step * 1e-6);
        expect(v).toBeLessThanOrEqual(max + t.step * 1e-6);
        // The label, read back, is the tick value: the axis tells the truth.
        expect(Number(labels[k].replace(/,/g, ""))).toBeCloseTo(v, 9);
      }
    }
  });

  it("returns nothing for an empty range", () => {
    expect(priceTicks(5, 5, 5).values).toEqual([]);
    expect(priceTicks(6, 5, 5).values).toEqual([]);
  });
});

describe("timeTicks", () => {
  const t0 = Date.UTC(2026, 9, 15, 12, 0, 3, 250);

  it("aligns ticks to whole UTC steps", () => {
    const t = timeTicks(t0, t0 + 5 * 60_000, 6);
    expect(t.step).toBe(60_000);
    expect(t.precision).toBe("m");
    for (const v of t.values) expect(v % t.step).toBe(0);
    expect(t.values.map((v) => formatTimeUTC(v, t.precision))).toEqual([
      "12:01",
      "12:02",
      "12:03",
      "12:04",
      "12:05",
    ]);
  });

  it("switches to seconds and milliseconds when zoomed in", () => {
    expect(timeTicks(t0, t0 + 20_000, 5).precision).toBe("s");
    const ms = timeTicks(t0, t0 + 900, 5);
    expect(ms.precision).toBe("ms");
    expect(ms.step).toBe(200);
  });

  it("has unique labels and stays inside the range for any span up to a day", () => {
    for (const step of TIME_STEPS) {
      const span = step * 4.5;
      if (span > 24 * 3_600_000) continue;
      const t = timeTicks(t0, t0 + span, 6);
      const labels = t.values.map((v) => formatTimeTick(v, t.precision));
      expect(new Set(labels).size).toBe(labels.length);
      for (const v of t.values) {
        expect(v).toBeGreaterThanOrEqual(t0);
        expect(v).toBeLessThanOrEqual(t0 + span);
      }
    }
  });

  it("labels a UTC midnight tick with the date", () => {
    const midnight = Date.UTC(2026, 9, 16);
    expect(formatTimeTick(midnight, "m")).toBe("16 Oct");
    expect(formatTimeTick(midnight + 3_600_000, "m")).toBe("01:00");
  });
});
