/**
 * Number and time formatting for prices, sizes and axes. Everything rounds
 * half away from zero on the decimal value (so 1.005 shows as 1.01, not the
 * 1.00 that `toFixed` gives for the binary 1.00499999...).
 */

/** Real minus sign: same width as "+" in most fonts, unlike the hyphen. */
export const MINUS = "−";

/** Rounds half away from zero at `decimals` places, using the decimal digits. */
export function roundHalfAway(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const digits = String(abs);
  if (digits.includes("e")) return sign * Number(abs.toFixed(decimals));
  // Shift the decimal point in the string, not by multiplying the binary value.
  const shifted = Math.round(Number(`${digits}e${decimals}`));
  return sign * Number(`${shifted}e-${decimals}`);
}

function groupThousands(text: string): string {
  const dot = text.indexOf(".");
  const int = dot === -1 ? text : text.slice(0, dot);
  const rest = dot === -1 ? "" : text.slice(dot);
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + rest;
}

export interface FixedOptions {
  /** Thousands separators (default true). */
  group?: boolean;
  /** Show "+" on positive values (default false). */
  sign?: boolean;
}

/** Fixed decimals, grouped, with a real minus sign. Never shows "-0.00". */
export function formatFixed(value: number, decimals: number, opts: FixedOptions = {}): string {
  if (!Number.isFinite(value)) return "—";
  const r = roundHalfAway(value, decimals);
  let text = Math.abs(r).toFixed(decimals);
  if (opts.group !== false) text = groupThousands(text);
  const sign = r < 0 ? MINUS : opts.sign && r > 0 ? "+" : "";
  return sign + text;
}

/** USD price of BTC-USD: always 2 decimals (the quote increment). */
export function formatPrice(value: number): string {
  return formatFixed(value, 2);
}

/** BTC size: 8 decimals (1 satoshi). */
export const SIZE_DECIMALS = 8;

/**
 * Parts for decimal-point alignment in a table column: `int` is right
 * aligned, `frac` + `pad` left aligned, so the points line up. Trailing zeros
 * go into `pad` (shown dimmed), so 0.5 reads as "0.5" but takes the same
 * width as 0.12345678.
 */
export interface DecimalParts {
  int: string;
  frac: string;
  pad: string;
}

export function splitDecimal(
  value: number,
  decimals: number,
  dimTrailingZeros = true,
): DecimalParts {
  const text = formatFixed(value, decimals);
  const dot = text.indexOf(".");
  if (dot === -1) return { int: text, frac: "", pad: "" };
  const int = text.slice(0, dot);
  const fraction = text.slice(dot); // ".12340000"
  if (!dimTrailingZeros) return { int, frac: fraction, pad: "" };
  let end = fraction.length;
  while (end > 1 && fraction[end - 1] === "0") end--;
  // All zeros: the dot itself is dimmed too ("1" + ".00000000").
  if (end === 1) return { int, frac: "", pad: fraction };
  return { int, frac: fraction.slice(0, end), pad: fraction.slice(end) };
}

const pad2 = (n: number) => (n < 10 ? "0" : "") + n;
const pad3 = (n: number) => (n < 10 ? "00" : n < 100 ? "0" : "") + n;

export type TimePrecision = "ms" | "s" | "m";

/** UTC wall time: "HH:MM", "HH:MM:SS" or "HH:MM:SS.mmm". Truncates, never rounds up. */
export function formatTimeUTC(ms: number, precision: TimePrecision = "ms"): string {
  if (!Number.isFinite(ms)) return "—";
  const whole = Math.floor(ms);
  const dayMs = ((whole % 86_400_000) + 86_400_000) % 86_400_000;
  const h = Math.floor(dayMs / 3_600_000);
  const m = Math.floor(dayMs / 60_000) % 60;
  const hm = `${pad2(h)}:${pad2(m)}`;
  if (precision === "m") return hm;
  const s = Math.floor(dayMs / 1000) % 60;
  if (precision === "s") return `${hm}:${pad2(s)}`;
  return `${hm}:${pad2(s)}.${pad3(dayMs % 1000)}`;
}

/** Short duration: "850 ms", "1.2 s", "12 s", "3 min 05 s", "1 h 02 min". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const abs = Math.max(0, ms);
  if (abs < 1000) return `${Math.floor(abs)} ms`;
  if (abs < 10_000) return `${formatFixed(Math.floor(abs / 100) / 10, 1)} s`;
  const totalS = Math.floor(abs / 1000);
  if (totalS < 60) return `${totalS} s`;
  const totalM = Math.floor(totalS / 60);
  if (totalM < 60) return `${totalM} min ${pad2(totalS % 60)} s`;
  return `${Math.floor(totalM / 60)} h ${pad2(totalM % 60)} min`;
}

export function formatCount(n: number): string {
  return formatFixed(n, 0);
}

export function formatMB(bytes: number): string {
  return `${formatFixed(bytes / (1024 * 1024), 1)} MB`;
}
