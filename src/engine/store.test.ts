import { describe, expect, it } from "vitest";
import type { BatchMessage, DepthSnapshot, FeedStatus } from "../feed/protocol.ts";
import { MarketStore } from "./store.ts";

const status = { source: "live" } as FeedStatus;
const empty = new Float64Array(0);

function depth(time: number): DepthSnapshot {
  return {
    time,
    source: "live",
    bestBid: 1,
    bestAsk: 2,
    rangePct: 0.5,
    bidPrices: empty,
    bidCum: empty,
    askPrices: empty,
    askCum: empty,
  };
}

function batch(points: number[], extra: Partial<BatchMessage> = {}): BatchMessage {
  return {
    type: "batch",
    reset: false,
    points: new Float64Array(points),
    depth: null,
    status,
    ...extra,
  };
}

describe("MarketStore", () => {
  it("unpacks batched points into the ring buffer and bumps versions", () => {
    const store = new MarketStore();
    store.ingest(batch([1000, 100.5, 0.1, 1, 1001, 100.6, 0.2, 0]));
    expect(store.points.length).toBe(2);
    expect(store.points.priceAt(1)).toBe(100.6);
    expect(store.points.flagsAt(0)).toBe(1);
    expect(store.pointsVersion).toBe(1);
    store.ingest(batch([]));
    expect(store.pointsVersion).toBe(1); // nothing new, nothing to redraw
    expect(store.statusVersion).toBe(2);
  });

  it("clears points on a reset batch", () => {
    const store = new MarketStore();
    store.ingest(batch([1, 1, 1, 0, 2, 2, 2, 0]));
    store.ingest(batch([5, 5, 5, 0], { reset: true }));
    expect(store.points.length).toBe(1);
    expect(store.points.firstTime).toBe(5);
  });

  it("records where data switches to and from simulated, for the chart bands", () => {
    const store = new MarketStore();
    // real 1..2, simulated 3..5, real 6..7
    store.ingest(batch([1, 1, 1, 0, 2, 1, 1, 0, 3, 1, 1, 2, 4, 1, 1, 2]));
    store.ingest(batch([5, 1, 1, 2, 6, 1, 1, 0, 7, 1, 1, 0]));
    expect(store.simSwitches).toEqual([3, 1, 6, 0]);
    expect(store.simBands(0, 10)).toEqual([3, 6]);
    expect(store.simBands(4, 10)).toEqual([4, 6]);
    expect(store.simBands(6, 10)).toEqual([]);
    store.ingest(batch([8, 1, 1, 2]));
    expect(store.simBands(0, 9)).toEqual([3, 6, 8, 9]); // open run ends at "to"
  });

  it("records at most one depth snapshot per second and finds them by time", () => {
    const store = new MarketStore();
    for (let t = 0; t <= 5000; t += 250) store.ingest(batch([], { depth: depth(t) }));
    expect(store.depthHistory.map((d) => d.time)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(store.depth?.time).toBe(5000);
    expect(store.depthAt(2999)?.time).toBe(2000);
    expect(store.depthAt(3000)?.time).toBe(3000);
    expect(store.depthAt(-1)).toBeNull();
  });
});
