import { describe, expect, it } from "vitest";
import { FRAME_BUDGET_MS, PerfStats, summarizeRun } from "./perfStats.ts";

describe("PerfStats", () => {
  it("computes FPS from frame intervals", () => {
    const s = new PerfStats();
    for (let i = 0; i < 120; i++) s.record(i * (1000 / 60), 1);
    expect(s.fps()).toBeCloseTo(60, 0);
    const slow = new PerfStats();
    for (let i = 0; i < 60; i++) slow.record(i * (1000 / 30), 1);
    expect(slow.fps()).toBeCloseTo(30, 0);
  });

  it("summarises draw times: avg, p95, max and frames over budget", () => {
    const s = new PerfStats();
    // 95 frames at 2 ms, then 5 slow frames.
    for (let i = 0; i < 95; i++) s.record(i * 16, 2);
    for (const [k, d] of [10, 12, 20, 30, 40].entries()) s.record((95 + k) * 16, d);
    const sum = s.summary(100);
    expect(sum.frames).toBe(100);
    expect(sum.avg).toBeCloseTo((95 * 2 + 112) / 100, 5);
    expect(sum.p95).toBe(2); // 95th of 100 sorted values
    expect(sum.max).toBe(40);
    expect(sum.overBudget).toBe(3); // 20, 30, 40 > 16.7
  });

  it("only looks at the newest frames once the window is full", () => {
    const s = new PerfStats(10);
    for (let i = 0; i < 10; i++) s.record(i * 16, 100);
    for (let i = 10; i < 20; i++) s.record(i * 16, 1);
    expect(s.summary(10).max).toBe(1);
    expect(s.drawAt(0)).toBe(1);
  });

  it("counts dropped frames from long intervals", () => {
    const s = new PerfStats();
    let t = 0;
    for (let i = 0; i < 30; i++) s.record((t += FRAME_BUDGET_MS), 1);
    s.record((t += FRAME_BUDGET_MS * 3), 1); // two frames missed
    s.record((t += FRAME_BUDGET_MS), 1);
    expect(s.droppedFrames()).toBe(2);
  });
});

describe("summarizeRun", () => {
  it("summarises a measurement run", () => {
    const draw = Array.from({ length: 600 }, (_, i) => (i < 590 ? 2 : 20));
    const interval = Array.from({ length: 599 }, (_, i) => (i === 10 ? 50 : 1000 / 60));
    const r = summarizeRun(draw, interval, 10_000);
    expect(r.frames).toBe(600);
    expect(r.fps).toBe(60);
    expect(r.p95).toBe(2);
    expect(r.p99).toBe(20);
    expect(r.max).toBe(20);
    expect(r.overBudget).toBe(10);
    expect(r.slowFrames).toBe(1);
    expect(r.avg).toBeCloseTo((590 * 2 + 10 * 20) / 600, 9);
  });

  it("is all zeros for an empty run", () => {
    expect(summarizeRun([], [], 1000).frames).toBe(0);
  });
});
