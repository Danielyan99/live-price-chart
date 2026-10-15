import { formatDuration } from "./format.ts";

export type Freshness =
  | { kind: "none"; label: string }
  | { kind: "fresh"; ageMs: number; label: string }
  | { kind: "stale"; ageMs: number; label: string };

/**
 * How old is the data on screen? `dataAsOf` is the local time the newest
 * delivered message arrived (any message: trade, book change or heartbeat),
 * so a quiet market with a healthy socket is still fresh, while a stalled
 * socket, a stuck worker or a blocked UI all make the age grow.
 */
export function freshness(nowMs: number, dataAsOf: number | null, thresholdMs: number): Freshness {
  if (dataAsOf === null || !(dataAsOf > 0)) return { kind: "none", label: "No data yet" };
  const ageMs = Math.max(0, nowMs - dataAsOf);
  if (ageMs > thresholdMs) {
    return { kind: "stale", ageMs, label: `Data ${formatDuration(ageMs)} old` };
  }
  return { kind: "fresh", ageMs, label: `Fresh · ${formatDuration(ageMs)}` };
}
