import { PointRing } from "../lib/ringBuffer.ts";
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
  /** Depth snapshots by time, oldest first (for replay). */
  readonly depthHistory: DepthSnapshot[] = [];
  status: FeedStatus | null = null;

  pointsVersion = 0;
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
      this.points.clear();
      this.depthHistory.length = 0;
    }
    const p = msg.points;
    const ring = this.points;
    for (let i = 0; i < p.length; i += POINT_STRIDE) {
      ring.push(p[i], p[i + 1], p[i + 2], p[i + 3]);
    }
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
