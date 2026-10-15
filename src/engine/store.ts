import { FLAG_SIM, PointRing } from "../lib/ringBuffer.ts";
import {
  POINT_STRIDE,
  type BatchMessage,
  type DepthSnapshot,
  type FeedStatus,
} from "../feed/protocol.ts";

/** Trade points kept in memory: fixed, so memory stays flat over long sessions. */
export const POINT_CAPACITY = 100_000;
/** Depth snapshots recorded for replay: one per second, last 30 minutes. */
const DEPTH_HISTORY_CAPACITY = 1800;
const DEPTH_HISTORY_INTERVAL_MS = 1000;

/**
 * Main-thread market data. Plain mutable objects, deliberately outside React:
 * batches from the worker land here and only bump version counters. Drawing
 * code compares versions in the frame loop to decide what to redraw.
 */
export class MarketStore {
  readonly points = new PointRing(POINT_CAPACITY);
  depth: DepthSnapshot | null = null;
  /**
   * Where the data switches between real and simulated, as pairs
   * [time, 1 = simulated from here | 0 = real from here]. Kept at ingest,
   * so drawing never has to scan every point's flags.
   */
  readonly simSwitches: number[] = [];
  private lastSim = 0;
  /** Depth snapshots by time, oldest first (for replay). */
  readonly depthHistory: DepthSnapshot[] = [];
  status: FeedStatus | null = null;

  pointsVersion = 0;
  /** Bumped when the points are replaced (prefill), so views drop caches. */
  resets = 0;
  depthVersion = 0;
  statusVersion = 0;

  /** Local time (Date.now) when the last batch arrived. */
  lastBatchAt = 0;
  /** Time spent in ingest() since the counter was last read (ms). */
  ingestMs = 0;
  batches = 0;

  ingest(msg: BatchMessage): void {
    const t0 = performance.now();
    if (msg.reset) {
      this.resets++;
      this.points.clear();
      this.depthHistory.length = 0;
      this.simSwitches.length = 0;
      this.lastSim = 0;
    }
    const p = msg.points;
    const ring = this.points;
    for (let i = 0; i < p.length; i += POINT_STRIDE) {
      ring.push(p[i], p[i + 1], p[i + 2], p[i + 3]);
      const sim = p[i + 3] & FLAG_SIM ? 1 : 0;
      if (sim !== this.lastSim) {
        this.simSwitches.push(p[i], sim);
        this.lastSim = sim;
      }
    }
    // Forget switches older than the buffer, keeping the one that sets the
    // state of the oldest point.
    const sw = this.simSwitches;
    let drop = 0;
    while (drop + 2 < sw.length && sw[drop + 2] <= ring.firstTime) drop += 2;
    if (drop > 0) sw.splice(0, drop);
    if (p.length > 0 || msg.reset) this.pointsVersion++;
    if (msg.depth) {
      this.depth = msg.depth;
      this.depthVersion++;
      this.recordDepth(msg.depth);
    }
    this.status = msg.status;
    this.statusVersion++;
    this.lastBatchAt = Date.now();
    this.batches++;
    this.ingestMs += performance.now() - t0;
  }

  private recordDepth(d: DepthSnapshot): void {
    const h = this.depthHistory;
    const last = h[h.length - 1];
    if (last && d.time - last.time < DEPTH_HISTORY_INTERVAL_MS) return;
    h.push(d);
    if (h.length > DEPTH_HISTORY_CAPACITY) h.shift();
  }

  /** Simulated time ranges overlapping [from, to], as flat [start, end, ...]. */
  simBands(from: number, to: number): number[] {
    const sw = this.simSwitches;
    const out: number[] = [];
    for (let k = 0; k < sw.length; k += 2) {
      if (sw[k + 1] !== 1) continue;
      const start = sw[k];
      const end = k + 2 < sw.length ? sw[k + 2] : Infinity;
      if (end <= from || start >= to) continue;
      out.push(Math.max(start, from), Math.min(end, to));
    }
    return out;
  }

  /** Newest recorded depth snapshot at or before `time`, or null. */
  depthAt(time: number): DepthSnapshot | null {
    const h = this.depthHistory;
    let lo = 0;
    let hi = h.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (h[mid].time <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 ? h[lo - 1] : null;
  }
}
