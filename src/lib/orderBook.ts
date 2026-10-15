/**
 * One side of an order book. Levels are kept sorted best-first (bids high to
 * low, asks low to high) in plain arrays, so the best level is index 0 and a
 * depth walk is a simple loop. Updates use binary search + splice.
 */
export class BookSide {
  readonly prices: number[] = [];
  readonly sizes: number[] = [];
  readonly isBid: boolean;

  constructor(isBid: boolean) {
    this.isBid = isBid;
  }

  get length(): number {
    return this.prices.length;
  }

  /** Best price, or NaN when the side is empty. */
  get best(): number {
    return this.prices.length > 0 ? this.prices[0] : NaN;
  }

  clear(): void {
    this.prices.length = 0;
    this.sizes.length = 0;
  }

  /** True when price `a` is better (closer to the spread) than `b`. */
  private better(a: number, b: number): boolean {
    return this.isBid ? a > b : a < b;
  }

  /** Index of `price` if present, otherwise the index where it would go. */
  private search(price: number): { index: number; found: boolean } {
    let lo = 0;
    let hi = this.prices.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const p = this.prices[mid];
      if (p === price) return { index: mid, found: true };
      if (this.better(p, price)) lo = mid + 1;
      else hi = mid;
    }
    return { index: lo, found: false };
  }

  /** Sets the size at a price level. A size of 0 removes the level. */
  set(price: number, size: number): void {
    const { index, found } = this.search(price);
    if (size <= 0) {
      if (found) {
        this.prices.splice(index, 1);
        this.sizes.splice(index, 1);
      }
    } else if (found) {
      this.sizes[index] = size;
    } else {
      this.prices.splice(index, 0, price);
      this.sizes.splice(index, 0, size);
    }
  }

  /** Size at a price, or 0 when there is no level. */
  sizeAt(price: number): number {
    const { index, found } = this.search(price);
    return found ? this.sizes[index] : 0;
  }

  /** Replaces all levels. Input order does not matter. */
  load(levels: ReadonlyArray<readonly [number, number]>): void {
    const sorted = levels
      .filter(([, size]) => size > 0)
      .sort(this.isBid ? (a, b) => b[0] - a[0] : (a, b) => a[0] - b[0]);
    this.prices.length = 0;
    this.sizes.length = 0;
    for (const [price, size] of sorted) {
      // Merge duplicate prices (the last one wins, like an update would).
      if (this.prices.length > 0 && this.prices[this.prices.length - 1] === price) {
        this.sizes[this.sizes.length - 1] = size;
      } else {
        this.prices.push(price);
        this.sizes.push(size);
      }
    }
  }
}

export class OrderBook {
  readonly bids = new BookSide(true);
  readonly asks = new BookSide(false);

  clear(): void {
    this.bids.clear();
    this.asks.clear();
  }

  get bestBid(): number {
    return this.bids.best;
  }

  get bestAsk(): number {
    return this.asks.best;
  }

  /** Mid price, or NaN when either side is empty. */
  get mid(): number {
    return (this.bids.best + this.asks.best) / 2;
  }

  /** A crossed book (bid >= ask) means we missed updates and must not be trusted. */
  get crossed(): boolean {
    return this.bids.best >= this.asks.best;
  }
}

/** Cumulative depth of one side, sampled from the best level outward. */
export interface DepthCurve {
  /** Level prices, moving away from the spread. */
  prices: Float64Array;
  /** Total size from the best level up to and including that price. */
  cumulative: Float64Array;
}

/**
 * Builds the cumulative depth curve of one side up to `limitPrice` (inclusive).
 * When more than `maxPoints` levels are in range, the levels are grouped into
 * equal price buckets and one point is kept per bucket: the last level of the
 * bucket, with the exact cumulative size at that price. So every returned
 * point is exact; only the steps between points are simplified.
 */
export function depthCurve(side: BookSide, limitPrice: number, maxPoints: number): DepthCurve {
  const { prices, sizes, isBid } = side;
  let n = 0;
  while (n < prices.length && (isBid ? prices[n] >= limitPrice : prices[n] <= limitPrice)) n++;

  if (n <= maxPoints) {
    const px = new Float64Array(n);
    const cum = new Float64Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      total += sizes[i];
      px[i] = prices[i];
      cum[i] = total;
    }
    return { prices: px, cumulative: cum };
  }

  const best = prices[0];
  const width = Math.abs(limitPrice - best) / maxPoints;
  const px = new Float64Array(maxPoints);
  const cum = new Float64Array(maxPoints);
  let out = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += sizes[i];
    const bucket = Math.min(maxPoints - 1, Math.floor(Math.abs(prices[i] - best) / width));
    const nextBucket =
      i + 1 < n
        ? Math.min(maxPoints - 1, Math.floor(Math.abs(prices[i + 1] - best) / width))
        : Infinity;
    if (nextBucket !== bucket) {
      px[out] = prices[i];
      cum[out] = total;
      out++;
    }
  }
  return { prices: px.slice(0, out), cumulative: cum.slice(0, out) };
}
