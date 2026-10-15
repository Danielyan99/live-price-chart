import { OrderBook } from "../lib/orderBook.ts";
import { Rng } from "../lib/rng.ts";
import type { TradeEvent } from "./coinbase.ts";

const TICK = 0.01;
/** Order-book levels kept per side. */
const MAX_LEVELS = 600;
/** Book levels reach about this far from the mid price (relative). */
const BOOK_REACH = 0.02;
/** After a long pause (sleeping tab), only this much time is caught up. */
const MAX_CATCH_UP_MS = 5000;

/** Rounds to whole cents. `Math.round(p * 100) / 100` gives the double closest
 * to the decimal value (82183.93), while `round(p / 0.01) * 0.01` does not. */
const roundTick = (p: number) => Math.round(p * 100) / 100;
const round8 = (x: number) => Math.round(x * 1e8) / 1e8;

export interface SimConfig {
  /** Trades per second at speed 1. */
  tradesPerSec: number;
  /** Order-book change batches per second at speed 1. */
  bookUpdatesPerSec: number;
  /** Relative price volatility per square-root second (0.0001 = 0.01 %). */
  volatility: number;
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  tradesPerSec: 40,
  bookUpdatesPerSec: 20,
  volatility: 0.0001,
};

export type SimEmit = (event: TradeEvent | { kind: "book" }) => void;

/**
 * A small synthetic market: the mid price follows a geometric random walk,
 * trades arrive as a Poisson process and hit the best bid or ask, and the
 * book is kept around the mid with random adds and cancels. Fully driven by
 * the clock passed to `advance`, so it is deterministic for a given seed.
 */
export class MarketSimulator {
  readonly book = new OrderBook();
  /** Rate multiplier: 10 means ten times more trades and book updates. */
  speed = 1;
  readonly config: SimConfig;

  private readonly rng: Rng;
  private mid: number;
  private clock: number;
  private lastMoveAt: number;
  private midAtLastTrade: number;
  private nextTradeAt: number;
  private nextBookAt: number;
  private nextId = 1;

  constructor(seed: number, startPrice: number, startTime: number, config = DEFAULT_SIM_CONFIG) {
    this.rng = new Rng(seed);
    this.config = { ...config };
    this.mid = startPrice;
    this.midAtLastTrade = startPrice;
    this.clock = startTime;
    this.lastMoveAt = startTime;
    this.nextTradeAt = startTime + this.waitFor(this.config.tradesPerSec);
    this.nextBookAt = startTime + this.waitFor(this.config.bookUpdatesPerSec);
    this.seedBook();
  }

  get time(): number {
    return this.clock;
  }

  get midPrice(): number {
    return this.mid;
  }

  /** Moves the mid to a given price (used to keep a simulated book around a live price). */
  anchor(price: number): void {
    if (Number.isFinite(price)) {
      this.mid = price;
      this.midAtLastTrade = price;
    }
  }

  /** Generates every event in (time, until], in time order. */
  advance(until: number, emit: SimEmit): void {
    if (until - this.clock > MAX_CATCH_UP_MS) {
      const skip = until - MAX_CATCH_UP_MS - this.clock;
      this.clock += skip;
      this.lastMoveAt += skip;
      this.nextTradeAt = Math.max(this.nextTradeAt, this.clock);
      this.nextBookAt = Math.max(this.nextBookAt, this.clock);
    }
    for (;;) {
      const isTrade = this.nextTradeAt <= this.nextBookAt;
      const t = isTrade ? this.nextTradeAt : this.nextBookAt;
      if (t > until) break;
      this.moveMid(t);
      this.recenter();
      if (isTrade) {
        this.trade(t, emit);
        this.nextTradeAt = t + this.waitFor(this.config.tradesPerSec);
      } else {
        this.churnBook();
        emit({ kind: "book" });
        this.nextBookAt = t + this.waitFor(this.config.bookUpdatesPerSec);
      }
    }
    this.clock = until;
  }

  private waitFor(ratePerSec: number): number {
    return this.rng.exponential(1000 / (ratePerSec * this.speed));
  }

  private moveMid(t: number): void {
    const dt = Math.max(0, t - this.lastMoveAt) / 1000;
    this.lastMoveAt = t;
    this.mid *= Math.exp(this.config.volatility * Math.sqrt(dt) * this.rng.normal());
  }

  private sizeFor(distanceTicks: number): number {
    const mean = Math.log(0.02) + 0.35 * Math.log(1 + distanceTicks / 50);
    return Math.max(1e-8, round8(Math.exp(mean + 1.2 * this.rng.normal())));
  }

  /** Log-uniform distance: many levels near the mid, fewer far away. */
  private randomDistanceTicks(): number {
    const maxTicks = (this.mid * BOOK_REACH) / TICK;
    return Math.max(1, Math.round(Math.exp(this.rng.next() * Math.log(maxTicks))));
  }

  /** Keeps the touch around the current mid: drops crossed levels, adds new best levels. */
  private recenter(): void {
    const { bids, asks } = this.book;
    const halfSpread = TICK * (0.5 + this.rng.exponential(3));
    const bidTop = Math.floor((this.mid - halfSpread) / TICK) * TICK;
    let askTop = Math.ceil((this.mid + halfSpread) / TICK) * TICK;
    if (askTop - bidTop < TICK / 2) askTop = bidTop + TICK;

    let k = 0;
    while (k < bids.length && bids.prices[k] > bidTop + TICK / 2) k++;
    if (k > 0) {
      bids.prices.splice(0, k);
      bids.sizes.splice(0, k);
    }
    k = 0;
    while (k < asks.length && asks.prices[k] < askTop - TICK / 2) k++;
    if (k > 0) {
      asks.prices.splice(0, k);
      asks.sizes.splice(0, k);
    }
    // New orders keep joining near the mid, so the spread stays tight.
    if (!(bids.best > bidTop - 3 * TICK)) bids.set(roundTick(bidTop), this.sizeFor(1));
    if (!(asks.best < askTop + 3 * TICK)) asks.set(roundTick(askTop), this.sizeFor(1));
  }

  private churnBook(): void {
    for (let i = 0; i < 6; i++) {
      const side = this.rng.next() < 0.5 ? this.book.bids : this.book.asks;
      if (this.rng.next() < 0.3 && side.length > 0) {
        // Cancel an existing level, more often near the top.
        const idx = Math.floor(side.length * this.rng.next() ** 2);
        side.set(side.prices[idx], 0);
      } else {
        const d = this.randomDistanceTicks();
        const ref = Number.isNaN(side.best) ? this.mid : side.best;
        const price = roundTick(side.isBid ? ref - d * TICK : ref + d * TICK);
        side.set(price, this.sizeFor(d));
      }
      if (side.length > MAX_LEVELS) {
        side.prices.length = MAX_LEVELS;
        side.sizes.length = MAX_LEVELS;
      }
    }
  }

  private trade(t: number, emit: SimEmit): void {
    // Momentum: buyers are more likely after the price went up.
    const up = this.mid >= this.midAtLastTrade;
    this.midAtLastTrade = this.mid;
    const takerBuy = this.rng.next() < (up ? 0.65 : 0.35);
    const side = takerBuy ? this.book.asks : this.book.bids;
    const price = side.best;
    const size = Math.max(1e-8, round8(Math.exp(Math.log(0.004) + 1.4 * this.rng.normal())));
    emit({ kind: "trade", id: this.nextId++, time: t, price, size, takerBuy });
    // The trade takes liquidity from the level it hit.
    const left = round8(side.sizes[0] - size);
    side.set(price, left > 0 ? left : 0);
    if (side.length === 0) this.recenter();
  }

  private seedBook(): void {
    this.recenter();
    for (let i = 0; i < 400; i++) {
      for (const side of [this.book.bids, this.book.asks]) {
        const d = this.randomDistanceTicks();
        const price = roundTick(side.isBid ? side.best - d * TICK : side.best + d * TICK);
        side.set(price, this.sizeFor(d));
      }
    }
  }
}
