import { formatDuration, formatTimeUTC } from "../lib/format.ts";
import type { PointRing } from "../lib/ringBuffer.ts";
import { setText } from "./dom.ts";
import type { FrameTask } from "./frameLoop.ts";
import { Observable } from "./observable.ts";

export const REPLAY_SPEEDS = [0.5, 1, 4, 16] as const;
/** A frame gap longer than this (background tab) is not replayed as a jump. */
const MAX_FRAME_DT_MS = 250;
/** The scrubber and labels are DOM: refreshed 10 times a second, not every frame. */
const LABEL_EVERY_MS = 100;

export interface ReplayUi {
  active: boolean;
  playing: boolean;
  speed: number;
  /** True when the cursor reached the newest recorded trade. */
  atEnd: boolean;
}

/**
 * Replay of the recorded session. Recording is always on: every trade is
 * in the ring buffer (last 100k) and the book is snapshotted once a second.
 * Replay moves a cursor through that recording; the chart, trades table,
 * depth chart and header all read "now" from the cursor instead of the
 * live clock, while live data keeps being recorded in the background.
 */
export class Replay implements FrameTask {
  readonly name = "replay";
  readonly ui = new Observable<ReplayUi>({ active: false, playing: false, speed: 1, atEnd: false });
  /** Replay time (exchange clock, ms). Only meaningful while active. */
  cursor = 0;

  private readonly points: PointRing;
  private readonly liveNow: () => number;
  private lastTs = NaN;
  private lastLabels = -Infinity;

  // DOM written every frame while active (no React render per frame).
  private scrubber: HTMLInputElement | null = null;
  private timeLabel: HTMLElement | null = null;
  private behindLabel: HTMLElement | null = null;
  private scrubbing = false;

  constructor(points: PointRing, liveNow: () => number) {
    this.points = points;
    this.liveNow = liveNow;
  }

  get active(): boolean {
    return this.ui.get().active;
  }

  /** Newest recorded time: the end of the replay range. */
  get end(): number {
    return this.points.lastTime;
  }

  /** Oldest recorded time still in the buffer. */
  get start(): number {
    return this.points.firstTime;
  }

  enter(): void {
    if (this.points.length === 0) return;
    this.cursor = this.start;
    this.lastTs = NaN;
    this.ui.set({ active: true, playing: true, atEnd: false });
  }

  exit(): void {
    this.ui.set({ active: false, playing: false, atEnd: false });
  }

  play(): void {
    if (!this.active) return;
    // Pressing play at the end starts over, like a media player.
    if (this.cursor >= this.end) this.cursor = this.start;
    this.lastTs = NaN;
    this.ui.set({ playing: true, atEnd: false });
  }

  pause(): void {
    this.ui.set({ playing: false });
  }

  togglePlay(): void {
    if (this.ui.get().playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number): void {
    this.ui.set({ speed });
  }

  /** Moves to the next (or previous) recorded trade, `count` trades away. Pauses. */
  step(direction: 1 | -1, count = 1): void {
    if (!this.active || this.points.length === 0) return;
    this.pause();
    const pts = this.points;
    if (direction > 0) {
      const i = Math.min(pts.length - 1, pts.upperBound(this.cursor) + count - 1);
      this.cursor = pts.timeAt(i);
    } else {
      // Back to the trade `count` before the first one at the cursor time
      // (several trades can share a timestamp).
      const i = Math.max(0, pts.lowerBound(this.cursor) - count);
      this.cursor = pts.timeAt(i);
    }
    this.syncEnd();
  }

  scrubTo(time: number): void {
    if (!this.active) return;
    this.cursor = Math.min(this.end, Math.max(this.start, time));
    this.syncEnd();
  }

  /** Advances the cursor by `dtMs` of wall time at the current speed. */
  advance(dtMs: number): void {
    const ui = this.ui.get();
    if (!ui.active) return;
    // The buffer may have dropped old points while we replay: stay inside it.
    if (this.cursor < this.start) this.cursor = this.start;
    if (!ui.playing) return;
    this.cursor += Math.min(dtMs, MAX_FRAME_DT_MS) * ui.speed;
    if (this.cursor >= this.end) {
      this.cursor = this.end;
      this.ui.set({ playing: false });
    }
    this.syncEnd();
  }

  private syncEnd(): void {
    this.ui.set({ atEnd: this.cursor >= this.end });
  }

  // ---- DOM --------------------------------------------------------------

  mount(root: HTMLElement): void {
    this.scrubber = root.querySelector<HTMLInputElement>("[data-replay=scrubber]");
    this.timeLabel = root.querySelector<HTMLElement>("[data-replay=time]");
    this.behindLabel = root.querySelector<HTMLElement>("[data-replay=behind]");
    const s = this.scrubber;
    if (s) {
      s.addEventListener("input", this.onScrub);
      s.addEventListener("pointerdown", this.onScrubStart);
      s.addEventListener("pointerup", this.onScrubEnd);
      s.addEventListener("pointercancel", this.onScrubEnd);
    }
  }

  unmount(): void {
    const s = this.scrubber;
    if (s) {
      s.removeEventListener("input", this.onScrub);
      s.removeEventListener("pointerdown", this.onScrubStart);
      s.removeEventListener("pointerup", this.onScrubEnd);
      s.removeEventListener("pointercancel", this.onScrubEnd);
    }
    this.scrubber = this.timeLabel = this.behindLabel = null;
  }

  private readonly onScrub = (): void => {
    if (this.scrubber) this.scrubTo(Number(this.scrubber.value));
  };

  private readonly onScrubStart = (): void => {
    this.scrubbing = true;
  };

  private readonly onScrubEnd = (): void => {
    this.scrubbing = false;
  };

  frame(now: number): void {
    const dt = Number.isNaN(this.lastTs) ? 0 : now - this.lastTs;
    this.lastTs = now;
    if (!this.active) return;
    this.advance(dt);
    if (now - this.lastLabels < LABEL_EVERY_MS) return;
    this.lastLabels = now;
    const s = this.scrubber;
    if (s && !this.scrubbing) {
      const min = String(this.start);
      const max = String(this.end);
      if (s.min !== min) s.min = min;
      if (s.max !== max) s.max = max;
      const value = String(this.cursor);
      if (s.value !== value) s.value = value;
      s.setAttribute("aria-valuetext", `${formatTimeUTC(this.cursor)} UTC`);
    }
    setText(this.timeLabel, `${formatTimeUTC(this.cursor)} UTC`);
    setText(this.behindLabel, `${formatDuration(this.liveNow() - this.cursor)} behind live`);
  }
}
