import { formatTimeUTC, roundHalfAway, type TimePrecision } from "./format.ts";

/**
 * Axis ticks that do not lie: steps are 1, 2, 2.5 or 5 times a power of ten,
 * tick values are exact multiples of the step, and the label precision comes
 * from the step, so two ticks can never round to the same label.
 */

export interface NiceStep {
  step: number;
  /** Decimals needed to print any multiple of `step` exactly. */
  decimals: number;
}

const MANTISSAS = [1, 2, 2.5, 5, 10];

/** Smallest nice step >= raw. */
export function niceStep(raw: number): NiceStep {
  if (!(raw > 0) || !Number.isFinite(raw)) return { step: 1, decimals: 0 };
  let exponent = Math.floor(Math.log10(raw));
  let base = 10 ** exponent;
  // log10 can be off by one ulp around exact powers of ten.
  if (raw / base >= 10) {
    exponent++;
    base *= 10;
  }
  let mantissa = MANTISSAS.find((m) => m * base >= raw * (1 - 1e-12)) ?? 10;
  if (mantissa === 10) {
    mantissa = 1;
    exponent++;
  }
  const decimals = Math.max(0, -exponent + (mantissa === 2.5 ? 1 : 0));
  return { step: roundHalfAway(mantissa * 10 ** exponent, Math.max(decimals, 0) + 2), decimals };
}

export interface PriceTicks extends NiceStep {
  values: number[];
}

/**
 * Ticks for a price axis between min and max, at most about `maxCount`.
 * `minStep` is the instrument's price increment (0.01 for BTC-USD): ticks
 * finer than the prices can ever be would be noise.
 */
export function priceTicks(min: number, max: number, maxCount: number, minStep = 0.01): PriceTicks {
  if (!(max > min) || maxCount < 1) return { step: minStep, decimals: 2, values: [] };
  let nice = niceStep((max - min) / maxCount);
  if (nice.step < minStep) nice = niceStep(minStep);
  const { step, decimals } = nice;
  const values: number[] = [];
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  for (let k = first; k <= last; k++) values.push(roundHalfAway(k * step, decimals));
  return { step, decimals, values };
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Steps that read well on a clock. Multiples of these line up with UTC. */
export const TIME_STEPS = [
  1,
  2,
  5,
  10,
  20,
  50,
  100,
  200,
  500,
  SECOND,
  2 * SECOND,
  5 * SECOND,
  10 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
];

export interface TimeTicks {
  step: number;
  precision: TimePrecision;
  values: number[];
}

/** Ticks for a UTC time axis between t0 and t1, at most about `maxCount`. */
export function timeTicks(t0: number, t1: number, maxCount: number): TimeTicks {
  if (!(t1 > t0) || maxCount < 1) return { step: SECOND, precision: "s", values: [] };
  const raw = (t1 - t0) / maxCount;
  const step = TIME_STEPS.find((s) => s >= raw) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const precision: TimePrecision = step < SECOND ? "ms" : step < MINUTE ? "s" : "m";
  const values: number[] = [];
  for (let k = Math.ceil(t0 / step); k * step <= t1; k++) values.push(k * step);
  return { step, precision, values };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Label for a time tick. A tick at UTC midnight shows the date ("16 Oct"), so a day change is never hidden. */
export function formatTimeTick(ms: number, precision: TimePrecision): string {
  if (ms % (24 * HOUR) === 0) {
    const d = new Date(ms);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }
  return formatTimeUTC(ms, precision);
}
