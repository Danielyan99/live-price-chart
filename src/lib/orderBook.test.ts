import { describe, expect, it } from "vitest";
import { BookSide, OrderBook, depthCurve } from "./orderBook.ts";
import { Rng } from "./rng.ts";

describe("BookSide", () => {
  it("keeps bids sorted high to low and asks low to high", () => {
    const bids = new BookSide(true);
    const asks = new BookSide(false);
    for (const p of [100, 102, 101, 99.5]) {
      bids.set(p, 1);
      asks.set(p, 1);
    }
    expect(bids.prices).toEqual([102, 101, 100, 99.5]);
    expect(asks.prices).toEqual([99.5, 100, 101, 102]);
    expect(bids.best).toBe(102);
    expect(asks.best).toBe(99.5);
  });

  it("updates a level in place and removes it on size 0", () => {
    const bids = new BookSide(true);
    bids.set(100, 1);
    bids.set(101, 2);
    bids.set(100, 5);
    expect(bids.sizes).toEqual([2, 5]);
    expect(bids.sizeAt(100)).toBe(5);
    bids.set(101, 0);
    expect(bids.prices).toEqual([100]);
    bids.set(55, 0); // removing a missing level is a no-op
    expect(bids.length).toBe(1);
    expect(bids.sizeAt(55)).toBe(0);
  });

  it("stays sorted under many random updates", () => {
    const rng = new Rng(7);
    const asks = new BookSide(false);
    const reference = new Map<number, number>();
    for (let i = 0; i < 5000; i++) {
      const price = Math.round((100 + rng.next() * 10) * 100) / 100;
      const size = rng.next() < 0.3 ? 0 : Math.round(rng.next() * 1e8) / 1e8;
      asks.set(price, size);
      if (size > 0) reference.set(price, size);
      else reference.delete(price);
    }
    const expected = [...reference.keys()].sort((a, b) => a - b);
    expect(asks.prices).toEqual(expected);
    expect(asks.sizes).toEqual(expected.map((p) => reference.get(p)));
  });

  it("loads a snapshot in any order, dropping empty levels", () => {
    const bids = new BookSide(true);
    bids.load([
      [100, 1],
      [102, 2],
      [101, 0],
      [99, 3],
    ]);
    expect(bids.prices).toEqual([102, 100, 99]);
    expect(bids.sizes).toEqual([2, 1, 3]);
  });
});

describe("OrderBook", () => {
  it("reports mid, and crossed only when bid >= ask", () => {
    const book = new OrderBook();
    book.bids.set(99.99, 1);
    book.asks.set(100.01, 1);
    expect(book.mid).toBeCloseTo(100, 10);
    expect(book.crossed).toBe(false);
    book.bids.set(100.01, 1);
    expect(book.crossed).toBe(true);
  });

  it("has a NaN mid when a side is empty", () => {
    const book = new OrderBook();
    book.bids.set(1, 1);
    expect(book.mid).toBeNaN();
  });
});

describe("depthCurve", () => {
  function sideFrom(isBid: boolean, levels: Array<[number, number]>): BookSide {
    const s = new BookSide(isBid);
    s.load(levels);
    return s;
  }

  it("returns every level with running totals when few levels are in range", () => {
    const asks = sideFrom(false, [
      [101, 1],
      [102, 2],
      [103, 4],
      [110, 8],
    ]);
    const c = depthCurve(asks, 105, 100);
    expect(Array.from(c.prices)).toEqual([101, 102, 103]);
    expect(Array.from(c.cumulative)).toEqual([1, 3, 7]);
  });

  it("buckets many levels but keeps exact totals and the full range", () => {
    const rng = new Rng(3);
    const levels: Array<[number, number]> = [];
    for (let i = 0; i < 2000; i++)
      levels.push([100 - i * 0.01, Math.round(rng.next() * 1e6) / 1e6]);
    const bids = sideFrom(true, levels);
    const limit = 90;
    const c = depthCurve(bids, limit, 50);

    expect(c.prices.length).toBeLessThanOrEqual(50);
    // Prices move away from the spread, totals never go down.
    for (let i = 1; i < c.prices.length; i++) {
      expect(c.prices[i]).toBeLessThan(c.prices[i - 1]);
      expect(c.cumulative[i]).toBeGreaterThanOrEqual(c.cumulative[i - 1]);
    }
    // Each sampled point is exact: equal to the true sum up to that price.
    for (let i = 0; i < c.prices.length; i++) {
      let sum = 0;
      for (let k = 0; k < bids.length && bids.prices[k] >= c.prices[i]; k++) sum += bids.sizes[k];
      expect(c.cumulative[i]).toBeCloseTo(sum, 9);
    }
    // The last point is the last level inside the limit.
    let total = 0;
    let lastPrice = NaN;
    for (let k = 0; k < bids.length && bids.prices[k] >= limit; k++) {
      total += bids.sizes[k];
      lastPrice = bids.prices[k];
    }
    expect(c.prices[c.prices.length - 1]).toBe(lastPrice);
    expect(c.cumulative[c.cumulative.length - 1]).toBeCloseTo(total, 9);
  });

  it("is empty for an empty side", () => {
    const c = depthCurve(new BookSide(true), 90, 10);
    expect(c.prices.length).toBe(0);
  });
});
