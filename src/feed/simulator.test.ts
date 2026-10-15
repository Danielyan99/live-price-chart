import { describe, expect, it } from "vitest";
import type { TradeEvent } from "./coinbase.ts";
import { MarketSimulator } from "./simulator.ts";

const T0 = Date.UTC(2026, 9, 15, 12);

function run(seed: number, seconds: number, speed = 1) {
  const sim = new MarketSimulator(seed, 80_000, T0);
  sim.speed = speed;
  const trades: TradeEvent[] = [];
  let books = 0;
  let touchOk = true;
  let crossed = false;
  // Advance in 50 ms steps, like the worker does.
  for (let t = T0 + 50; t <= T0 + seconds * 1000; t += 50) {
    sim.advance(t, (e) => {
      if (e.kind === "trade") {
        trades.push(e);
        const touch = e.takerBuy ? sim.book.bestAsk : sim.book.bestBid;
        if (touch !== e.price) touchOk = false;
      } else {
        books++;
      }
      if (sim.book.crossed) crossed = true;
    });
  }
  return { sim, trades, books, touchOk, crossed };
}

describe("MarketSimulator", () => {
  it("is deterministic for a given seed", () => {
    const a = run(42, 10).trades;
    const b = run(42, 10).trades;
    const c = run(43, 10).trades;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("produces about tradesPerSec trades per second (Poisson)", () => {
    const { trades, books } = run(1, 60);
    // 40/s for 60 s: mean 2400, sd about 49. Allow 5 sd.
    expect(trades.length).toBeGreaterThan(2400 - 250);
    expect(trades.length).toBeLessThan(2400 + 250);
    expect(books).toBeGreaterThan(1200 - 200);
  });

  it("multiplies the rate by speed (stress mode)", () => {
    const { trades } = run(1, 10, 10);
    // 400/s for 10 s: mean 4000, sd about 63.
    expect(trades.length).toBeGreaterThan(4000 - 350);
    expect(trades.length).toBeLessThan(4000 + 350);
  });

  it("keeps time order, cent prices and positive sizes", () => {
    const { trades } = run(5, 20);
    for (let i = 1; i < trades.length; i++) {
      expect(trades[i].time).toBeGreaterThan(trades[i - 1].time);
    }
    for (const t of trades) {
      // Exactly the double for a 2-decimal number: no 82183.93000000001.
      expect(t.price).toBe(Number(t.price.toFixed(2)));
      expect(t.size).toBeGreaterThan(0);
      expect(t.time).toBeGreaterThan(T0);
      expect(t.time).toBeLessThanOrEqual(T0 + 20_000);
    }
  });

  it("never crosses the book, and trades hit the best bid or ask", () => {
    const { touchOk, crossed, sim } = run(9, 30);
    expect(crossed).toBe(false);
    expect(touchOk).toBe(true);
    expect(sim.book.bids.length).toBeGreaterThan(50);
    expect(sim.book.asks.length).toBeGreaterThan(50);
    expect(sim.book.bestBid).toBeLessThan(sim.midPrice);
    expect(sim.book.bestAsk).toBeGreaterThan(sim.midPrice);
  });

  it("only catches up the last 5 s after a long pause", () => {
    const sim = new MarketSimulator(2, 80_000, T0);
    let n = 0;
    sim.advance(T0 + 60 * 60 * 1000, () => n++);
    // An hour at 60 events/s would be ~216k events; 5 s is ~300.
    expect(n).toBeLessThan(600);
    expect(sim.time).toBe(T0 + 60 * 60 * 1000);
  });
});
