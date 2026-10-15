/** Point flag: the taker (aggressor) bought. Not set means the taker sold. */
export const FLAG_BUY = 1;
/** Point flag: the point came from the simulated feed, not the exchange. */
export const FLAG_SIM = 2;

/**
 * Fixed-size ring buffer of trade points, stored as parallel typed arrays
 * (struct of arrays). All memory is allocated once in the constructor, so a
 * session that runs for hours uses the same memory as one that runs for
 * seconds: when the buffer is full, the oldest point is overwritten.
 *
 * Logical index 0 is the oldest point and `length - 1` the newest. Times must
 * be pushed in non-decreasing order; the binary searches rely on it.
 */
export class PointRing {
  readonly capacity: number;
  readonly time: Float64Array;
  readonly price: Float64Array;
  readonly size: Float64Array;
  readonly flags: Uint8Array;

  /** Physical slot that the next push writes to. */
  private head = 0;
  private count = 0;
  private total = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.time = new Float64Array(capacity);
    this.price = new Float64Array(capacity);
    this.size = new Float64Array(capacity);
    this.flags = new Uint8Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  /** Points ever pushed, including the ones already overwritten. */
  get totalPushed(): number {
    return this.total;
  }

  /** Points dropped because the buffer was full. */
  get evicted(): number {
    return this.total - this.count;
  }

  /** Bytes held by the typed arrays. Constant for the life of the buffer. */
  get byteLength(): number {
    return (
      this.time.byteLength + this.price.byteLength + this.size.byteLength + this.flags.byteLength
    );
  }

  push(time: number, price: number, size: number, flags: number): void {
    const h = this.head;
    this.time[h] = time;
    this.price[h] = price;
    this.size[h] = size;
    this.flags[h] = flags;
    this.head = h + 1 === this.capacity ? 0 : h + 1;
    if (this.count < this.capacity) this.count++;
    this.total++;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.total = 0;
  }

  /** Physical slot of logical index `i` (0 = oldest). No bounds check. */
  slot(i: number): number {
    let j = this.head - this.count + i;
    if (j < 0) j += this.capacity;
    else if (j >= this.capacity) j -= this.capacity;
    return j;
  }

  timeAt(i: number): number {
    return this.time[this.slot(i)];
  }

  priceAt(i: number): number {
    return this.price[this.slot(i)];
  }

  sizeAt(i: number): number {
    return this.size[this.slot(i)];
  }

  flagsAt(i: number): number {
    return this.flags[this.slot(i)];
  }

  /** Time of the newest point, or NaN when empty. */
  get lastTime(): number {
    return this.count === 0 ? NaN : this.timeAt(this.count - 1);
  }

  /** Time of the oldest point, or NaN when empty. */
  get firstTime(): number {
    return this.count === 0 ? NaN : this.timeAt(0);
  }

  /** First logical index whose time is >= t (`length` if none). */
  lowerBound(t: number): number {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.timeAt(mid) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** First logical index whose time is > t (`length` if none). */
  upperBound(t: number): number {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.timeAt(mid) <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Calls `fn` with the contiguous physical ranges [start, end) that cover the
   * logical range [from, to), in order. At most two calls (when the range
   * wraps). Hot loops use this to read the typed arrays directly.
   */
  segments(from: number, to: number, fn: (start: number, end: number) => void): void {
    from = Math.max(0, from);
    to = Math.min(this.count, to);
    if (from >= to) return;
    const a = this.slot(from);
    const n = to - from;
    if (a + n <= this.capacity) {
      fn(a, a + n);
    } else {
      fn(a, this.capacity);
      fn(0, a + n - this.capacity);
    }
  }
}
