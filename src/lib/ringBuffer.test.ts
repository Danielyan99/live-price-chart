import { describe, expect, it } from "vitest";
import { FLAG_BUY, PointRing } from "./ringBuffer.ts";

function times(ring: PointRing): number[] {
  return Array.from({ length: ring.length }, (_, i) => ring.timeAt(i));
}

describe("PointRing", () => {
  it("rejects a capacity that is not a positive integer", () => {
    expect(() => new PointRing(0)).toThrow(RangeError);
    expect(() => new PointRing(-5)).toThrow(RangeError);
    expect(() => new PointRing(2.5)).toThrow(RangeError);
  });

  it("keeps points oldest-first before it is full", () => {
    const ring = new PointRing(5);
    ring.push(1, 100, 0.5, FLAG_BUY);
    ring.push(2, 101, 0.25, 0);
    expect(ring.length).toBe(2);
    expect(times(ring)).toEqual([1, 2]);
    expect(ring.priceAt(1)).toBe(101);
    expect(ring.sizeAt(0)).toBe(0.5);
    expect(ring.flagsAt(0)).toBe(FLAG_BUY);
    expect(ring.firstTime).toBe(1);
    expect(ring.lastTime).toBe(2);
  });

  it("overwrites the oldest points when it wraps around", () => {
    const ring = new PointRing(4);
    for (let t = 1; t <= 10; t++) ring.push(t, t * 10, 1, 0);
    expect(ring.length).toBe(4);
    expect(times(ring)).toEqual([7, 8, 9, 10]);
    expect(ring.priceAt(0)).toBe(70);
    expect(ring.totalPushed).toBe(10);
    expect(ring.evicted).toBe(6);
  });

  it("never grows: the same arrays are reused for every push", () => {
    const ring = new PointRing(1000);
    const { time, price } = ring;
    const bytes = ring.byteLength;
    for (let t = 0; t < 50_000; t++) ring.push(t, t, t, 0);
    expect(ring.time).toBe(time);
    expect(ring.price).toBe(price);
    expect(ring.byteLength).toBe(bytes);
    expect(ring.length).toBe(1000);
    expect(ring.firstTime).toBe(49_000);
  });

  it("reports NaN times when empty and after clear()", () => {
    const ring = new PointRing(3);
    expect(ring.firstTime).toBeNaN();
    ring.push(1, 1, 1, 0);
    ring.clear();
    expect(ring.length).toBe(0);
    expect(ring.lastTime).toBeNaN();
    ring.push(5, 1, 1, 0);
    expect(times(ring)).toEqual([5]);
  });

  it("binary-searches by time across the wrap point, with duplicate times", () => {
    const ring = new PointRing(6);
    // After 9 pushes the logical order starts in the middle of the arrays.
    for (const t of [0, 1, 2, 10, 20, 20, 20, 30, 40]) ring.push(t, 1, 1, 0);
    expect(times(ring)).toEqual([10, 20, 20, 20, 30, 40]);
    expect(ring.lowerBound(20)).toBe(1);
    expect(ring.upperBound(20)).toBe(4);
    expect(ring.lowerBound(5)).toBe(0);
    expect(ring.lowerBound(25)).toBe(4);
    expect(ring.upperBound(40)).toBe(6);
    expect(ring.lowerBound(99)).toBe(6);
  });

  it("splits a wrapped logical range into two physical segments", () => {
    const ring = new PointRing(5);
    for (let t = 1; t <= 7; t++) ring.push(t, t, 1, 0); // holds 3..7
    const seen: number[] = [];
    const calls: Array<[number, number]> = [];
    ring.segments(0, ring.length, (start, end) => {
      calls.push([start, end]);
      for (let j = start; j < end; j++) seen.push(ring.time[j]);
    });
    expect(seen).toEqual([3, 4, 5, 6, 7]);
    expect(calls).toHaveLength(2);
  });

  it("uses one segment when the range does not wrap, and clamps bounds", () => {
    const ring = new PointRing(10);
    for (let t = 1; t <= 4; t++) ring.push(t, t, 1, 0);
    const calls: Array<[number, number]> = [];
    ring.segments(-3, 99, (start, end) => calls.push([start, end]));
    expect(calls).toEqual([[0, 4]]);
    const none: Array<[number, number]> = [];
    ring.segments(2, 2, (s, e) => none.push([s, e]));
    expect(none).toEqual([]);
  });
});
