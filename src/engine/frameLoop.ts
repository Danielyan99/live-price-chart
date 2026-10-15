import { PerfStats } from "./perfStats.ts";

/** Something drawn by the frame loop. It decides itself whether it is dirty. */
export interface FrameTask {
  readonly name: string;
  frame(now: number): void;
}

/**
 * The one requestAnimationFrame loop of the app. Data never draws: a batch
 * from the worker only bumps version counters in the store, and each task
 * compares versions here, once per frame, and redraws only when something
 * it shows changed. Every frame's draw time is measured.
 */
export class FrameLoop {
  readonly perf = new PerfStats();
  /** Smoothed draw time per task (ms), for the breakdown in the perf panel. */
  readonly taskMs = new Map<string, number>();
  private readonly tasks: FrameTask[] = [];
  private running = false;

  add(task: FrameTask): void {
    if (!this.tasks.includes(task)) this.tasks.push(task);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.tick);
  }

  private readonly tick = (timestamp: number): void => {
    const start = performance.now();
    let t = start;
    for (const task of this.tasks) {
      task.frame(timestamp);
      const end = performance.now();
      const prev = this.taskMs.get(task.name) ?? 0;
      this.taskMs.set(task.name, prev + (end - t - prev) * 0.05);
      t = end;
    }
    this.perf.record(timestamp, t - start);
    requestAnimationFrame(this.tick);
  };
}
