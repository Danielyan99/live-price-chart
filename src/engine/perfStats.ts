/** 60 FPS frame budget. */
export const FRAME_BUDGET_MS = 1000 / 60;

/** A frame interval this much over budget means at least one frame was dropped. */
const DROPPED_FRAME_MS = FRAME_BUDGET_MS * 1.5;

export interface DrawSummary {
  frames: number;
  avg: number;
  p95: number;
  max: number;
  overBudget: number;
}

/**
 * Rolling per-frame measurements, kept in fixed typed arrays (no garbage per
 * frame). `drawMs` is the JS time spent drawing in one frame; `intervalMs`
 * is the time between two animation frames (what FPS is made of).
 */
export class PerfStats {
  readonly capacity: number;
  readonly drawMs: Float32Array;
  readonly intervalMs: Float32Array;
  private head = 0;
  private count = 0;
  private lastTs = NaN;
  private scratch: Float32Array;

  constructor(capacity = 600) {
    this.capacity = capacity;
    this.drawMs = new Float32Array(capacity);
    this.intervalMs = new Float32Array(capacity);
    this.scratch = new Float32Array(capacity);
  }

  get frames(): number {
    return this.count;
  }

  /** Call once per animation frame with its timestamp and the draw time. */
  record(timestamp: number, drawMs: number): void {
    const interval = Number.isNaN(this.lastTs) ? FRAME_BUDGET_MS : timestamp - this.lastTs;
    this.lastTs = timestamp;
    this.drawMs[this.head] = drawMs;
    this.intervalMs[this.head] = interval;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Draw time of the frame `ago` frames back (0 = newest). */
  drawAt(ago: number): number {
    return this.drawMs[(this.head - 1 - ago + 2 * this.capacity) % this.capacity];
  }

  intervalAt(ago: number): number {
    return this.intervalMs[(this.head - 1 - ago + 2 * this.capacity) % this.capacity];
  }

  /** Frames per second over the newest `windowMs` of frame intervals. */
  fps(windowMs = 1000): number {
    let sum = 0;
    let n = 0;
    while (n < this.count && sum < windowMs) {
      sum += this.intervalAt(n);
      n++;
    }
    return sum > 0 ? (n * 1000) / sum : 0;
  }

  /** Frames whose interval shows dropped frames, in the newest `windowMs`. */
  droppedFrames(windowMs = 10_000): number {
    let sum = 0;
    let dropped = 0;
    for (let n = 0; n < this.count && sum < windowMs; n++) {
      const iv = this.intervalAt(n);
      sum += iv;
      if (iv > DROPPED_FRAME_MS) dropped += Math.round(iv / FRAME_BUDGET_MS) - 1;
    }
    return dropped;
  }

  /** Draw-time statistics over the newest `frames` frames. */
  summary(frames = 120): DrawSummary {
    const n = Math.min(frames, this.count);
    if (n === 0) return { frames: 0, avg: 0, p95: 0, max: 0, overBudget: 0 };
    let sum = 0;
    let max = 0;
    let over = 0;
    for (let k = 0; k < n; k++) {
      const d = this.drawAt(k);
      this.scratch[k] = d;
      sum += d;
      if (d > max) max = d;
      if (d > FRAME_BUDGET_MS) over++;
    }
    const sorted = this.scratch.subarray(0, n).sort();
    const p95 = sorted[Math.min(n - 1, Math.ceil(n * 0.95) - 1)];
    return { frames: n, avg: sum / n, p95, max, overBudget: over };
  }
}

export interface FrameRunSummary {
  frames: number;
  fps: number;
  avg: number;
  p95: number;
  p99: number;
  max: number;
  /** Frames whose draw time alone was over the 16.7 ms budget. */
  overBudget: number;
  /** Frame intervals over 33.4 ms: at least one 60 Hz frame was missed. */
  slowFrames: number;
}

/** Summary of a measurement run: per-frame draw times and frame intervals. */
export function summarizeRun(
  draw: readonly number[],
  interval: readonly number[],
  elapsedMs: number,
): FrameRunSummary {
  const n = draw.length;
  if (n === 0)
    return { frames: 0, fps: 0, avg: 0, p95: 0, p99: 0, max: 0, overBudget: 0, slowFrames: 0 };
  const sorted = Float64Array.from(draw).sort();
  const pick = (q: number) => sorted[Math.min(n - 1, Math.ceil(n * q) - 1)];
  let sum = 0;
  let over = 0;
  for (const d of draw) {
    sum += d;
    if (d > FRAME_BUDGET_MS) over++;
  }
  let slow = 0;
  for (const iv of interval) if (iv > 2 * FRAME_BUDGET_MS) slow++;
  return {
    frames: n,
    fps: (n * 1000) / elapsedMs,
    avg: sum / n,
    p95: pick(0.95),
    p99: pick(0.99),
    max: sorted[n - 1],
    overBudget: over,
    slowFrames: slow,
  };
}
