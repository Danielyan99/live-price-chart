import { describe, expect, it } from "vitest";
import {
  MINUS,
  formatDuration,
  formatFixed,
  formatPrice,
  formatTimeUTC,
  roundHalfAway,
  splitDecimal,
} from "./format.ts";

describe("roundHalfAway", () => {
  it("rounds on the decimal value, not the binary one", () => {
    expect((1.005).toFixed(2)).toBe("1.00"); // the bug we avoid
    expect(roundHalfAway(1.005, 2)).toBe(1.01);
    expect(roundHalfAway(0.125, 2)).toBe(0.13);
    expect(roundHalfAway(2.675, 2)).toBe(2.68);
  });

  it("rounds half away from zero for negatives too", () => {
    expect(roundHalfAway(-1.005, 2)).toBe(-1.01);
    expect(roundHalfAway(-0.5, 0)).toBe(-1);
  });

  it("cleans float noise from arithmetic", () => {
    expect(roundHalfAway(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundHalfAway(82183.93000000001, 2)).toBe(82183.93);
  });

  it("handles exponent notation and non-finite values", () => {
    expect(roundHalfAway(1e-7, 8)).toBe(1e-7);
    expect(roundHalfAway(1e21, 2)).toBe(1e21);
    expect(roundHalfAway(NaN, 2)).toBeNaN();
  });
});

describe("formatFixed / formatPrice", () => {
  it("groups thousands and keeps the requested decimals", () => {
    expect(formatPrice(82344.7)).toBe("82,344.70");
    expect(formatPrice(1234567.891)).toBe("1,234,567.89");
    expect(formatPrice(999.995)).toBe("1,000.00");
    expect(formatFixed(1234.5, 0)).toBe("1,235");
    expect(formatFixed(1234.5, 1, { group: false })).toBe("1234.5");
  });

  it("uses a real minus sign and never prints negative zero", () => {
    expect(formatFixed(-12.345, 2)).toBe(`${MINUS}12.35`);
    expect(formatFixed(-0.001, 2)).toBe("0.00");
    expect(formatFixed(-0, 2)).toBe("0.00");
    expect(formatFixed(12.3, 2, { sign: true })).toBe("+12.30");
    expect(formatFixed(0, 2, { sign: true })).toBe("0.00");
  });

  it("shows a dash for missing values", () => {
    expect(formatPrice(NaN)).toBe("—");
    expect(formatPrice(Infinity)).toBe("—");
  });
});

describe("splitDecimal (decimal-point alignment)", () => {
  it("splits integer, significant fraction and dimmed trailing zeros", () => {
    expect(splitDecimal(0.0060768, 8)).toEqual({ int: "0", frac: ".0060768", pad: "0" });
    expect(splitDecimal(1.5, 8)).toEqual({ int: "1", frac: ".5", pad: "0000000" });
    expect(splitDecimal(2, 8)).toEqual({ int: "2", frac: "", pad: ".00000000" });
    expect(splitDecimal(82344.77, 2)).toEqual({ int: "82,344", frac: ".77", pad: "" });
  });

  it("gives every value the same fraction width, so decimal points line up", () => {
    const values = [0.0060768, 12.5, 0.00000001, 3, 1234.12345678];
    const widths = values.map((v) => {
      const p = splitDecimal(v, 8);
      return p.frac.length + p.pad.length;
    });
    expect(new Set(widths)).toEqual(new Set([9])); // "." + 8 digits
  });

  it("can keep zeros undimmed", () => {
    expect(splitDecimal(1.5, 3, false)).toEqual({ int: "1", frac: ".500", pad: "" });
  });
});

describe("formatTimeUTC", () => {
  const t = Date.UTC(2026, 9, 15, 9, 5, 7, 42) + 0.925;
  it("formats in UTC at each precision", () => {
    expect(formatTimeUTC(t)).toBe("09:05:07.042");
    expect(formatTimeUTC(t, "s")).toBe("09:05:07");
    expect(formatTimeUTC(t, "m")).toBe("09:05");
  });

  it("truncates instead of rounding into the next second", () => {
    expect(formatTimeUTC(Date.UTC(2026, 0, 1, 23, 59, 59, 999) + 0.9)).toBe("23:59:59.999");
    expect(formatTimeUTC(Date.UTC(2026, 0, 1, 23, 59, 59, 999), "s")).toBe("23:59:59");
  });
});

describe("formatDuration", () => {
  it("picks a readable unit", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(1249)).toBe("1.2 s");
    expect(formatDuration(1299)).toBe("1.2 s"); // truncated, like a clock
    expect(formatDuration(12_400)).toBe("12 s");
    expect(formatDuration(185_000)).toBe("3 min 05 s");
    expect(formatDuration(3_720_000)).toBe("1 h 02 min");
    expect(formatDuration(-5)).toBe("0 ms");
  });
});
