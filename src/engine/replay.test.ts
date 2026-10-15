import { describe, expect, it } from "vitest";
import { PointRing } from "../lib/ringBuffer.ts";
import { Replay } from "./replay.ts";

function setup(times: number[], capacity = 100) {
  const ring = new PointRing(capacity);
  for (const t of times) ring.push(t, 100 + t / 1000, 1, 0);
  const replay = new Replay(ring, () => 10_000);
  return { ring, replay };
}

describe("Replay", () => {
  it("starts at the beginning of the recording, playing", () => {
    const { replay } = setup([1000, 2000, 3000]);
    replay.enter();
    expect(replay.cursor).toBe(1000);
    expect(replay.ui.get()).toMatchObject({ active: true, playing: true });
  });

  it("plays at the chosen speed and stops at the newest trade", () => {
    const { replay } = setup([1000, 2000, 3000]);
    replay.enter();
    replay.setSpeed(4);
    replay.advance(100); // 100 ms of wall time at 4x
    expect(replay.cursor).toBe(1400);
    replay.setSpeed(0.5);
    replay.advance(200);
    expect(replay.cursor).toBe(1500);
    replay.setSpeed(16);
    for (let i = 0; i < 20; i++) replay.advance(100);
    expect(replay.cursor).toBe(3000);
    expect(replay.ui.get()).toMatchObject({ playing: false, atEnd: true });
  });

  it("does not jump after a long gap between frames (background tab)", () => {
    const { replay } = setup([0, 100_000]);
    replay.enter();
    replay.advance(60_000);
    expect(replay.cursor).toBe(250);
  });

  it("steps trade by trade, and pauses", () => {
    const { replay } = setup([1000, 2000, 2000, 3000, 4000]);
    replay.enter(); // cursor 1000: one trade shown
    replay.step(1);
    expect(replay.cursor).toBe(2000);
    expect(replay.ui.get().playing).toBe(false);
    replay.step(1);
    expect(replay.cursor).toBe(3000);
    replay.step(-1);
    expect(replay.cursor).toBe(2000);
    replay.step(-1);
    expect(replay.cursor).toBe(1000);
    replay.step(-1); // already at the first trade
    expect(replay.cursor).toBe(1000);
    replay.step(1, 10); // clamps at the newest
    expect(replay.cursor).toBe(4000);
  });

  it("clamps scrubbing to the recorded range", () => {
    const { replay } = setup([1000, 5000]);
    replay.enter();
    replay.scrubTo(3000);
    expect(replay.cursor).toBe(3000);
    replay.scrubTo(-50);
    expect(replay.cursor).toBe(1000);
    replay.scrubTo(9e9);
    expect(replay.cursor).toBe(5000);
    expect(replay.ui.get().atEnd).toBe(true);
  });

  it("restarts from the beginning when play is pressed at the end", () => {
    const { replay } = setup([1000, 2000]);
    replay.enter();
    replay.scrubTo(2000);
    replay.pause();
    replay.play();
    expect(replay.cursor).toBe(1000);
    expect(replay.ui.get().playing).toBe(true);
  });

  it("follows the buffer when old points are evicted during replay", () => {
    const { ring, replay } = setup([1000, 2000, 3000], 3);
    replay.enter();
    replay.pause();
    ring.push(4000, 1, 1, 0); // evicts t=1000
    replay.advance(16);
    expect(replay.cursor).toBe(2000);
  });

  it("ignores controls while not active", () => {
    const { replay } = setup([1000, 2000]);
    replay.step(1);
    replay.scrubTo(1500);
    replay.advance(100);
    expect(replay.ui.get().active).toBe(false);
    expect(replay.cursor).toBe(0);
  });
});
