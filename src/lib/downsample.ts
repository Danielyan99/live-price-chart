/**
 * Min/max downsampling to the screen width (the "M4" idea): points are put
 * into pixel columns by time, and for each column only the first, lowest,
 * highest and last point are kept, in time order. A line through those
 * vertices covers exactly the same pixels as a line through every point, so
 * a one-trade spike stays visible even at 1,000 points per pixel.
 *
 * When there are no more points than columns, every point is kept as is.
 *
 * Points must be added in time order. Points outside [xMin, xMax] are
 * allowed (one on each side keeps the line running to the plot edges); they
 * go into their own columns and do not count for the visible min/max.
 */
export class MinMaxDownsampler {
  /** Output vertex times and prices; valid up to `count`. */
  t = new Float64Array(0);
  p = new Float64Array(0);
  count = 0;
  /** Lowest/highest price of the points inside [xMin, xMax]. NaN if none. */
  min = NaN;
  max = NaN;
  /** Points added, and how many of them were inside [xMin, xMax]. */
  seen = 0;
  inView = 0;

  private xMin = 0;
  private xMax = 1;
  private scale = 1;
  private passThrough = false;

  // Current column: indices (add order) and values of first/min/max/last.
  private col = NaN;
  private firstI = 0;
  private firstT = 0;
  private firstP = 0;
  private lastI = 0;
  private lastT = 0;
  private lastP = 0;
  private minI = 0;
  private minT = 0;
  private minP = 0;
  private maxI = 0;
  private maxT = 0;
  private maxP = 0;

  /**
   * Starts a pass. `expectedPoints` is how many points will be added; when it
   * is not more than `columns`, points are passed through untouched.
   */
  begin(xMin: number, xMax: number, columns: number, expectedPoints: number): void {
    const cols = Math.max(1, Math.floor(columns));
    this.xMin = xMin;
    this.xMax = xMax;
    this.scale = cols / (xMax - xMin);
    this.passThrough = expectedPoints <= cols;
    const need = this.passThrough ? expectedPoints : 4 * (cols + 2);
    if (this.t.length < need) {
      this.t = new Float64Array(need);
      this.p = new Float64Array(need);
    }
    this.count = 0;
    this.min = NaN;
    this.max = NaN;
    this.seen = 0;
    this.inView = 0;
    this.col = NaN;
  }

  add(time: number, price: number): void {
    const i = this.seen++;
    if (time >= this.xMin && time <= this.xMax) {
      this.inView++;
      if (!(price >= this.min)) this.min = price;
      if (!(price <= this.max)) this.max = price;
    }
    if (this.passThrough) {
      this.emit(time, price);
      return;
    }
    const col = Math.floor((time - this.xMin) * this.scale);
    if (col !== this.col) {
      if (i > 0) this.flushColumn();
      this.col = col;
      this.firstI = this.lastI = this.minI = this.maxI = i;
      this.firstT = this.lastT = this.minT = this.maxT = time;
      this.firstP = this.lastP = this.minP = this.maxP = price;
      return;
    }
    this.lastI = i;
    this.lastT = time;
    this.lastP = price;
    if (price < this.minP) {
      this.minI = i;
      this.minT = time;
      this.minP = price;
    }
    if (price > this.maxP) {
      this.maxI = i;
      this.maxT = time;
      this.maxP = price;
    }
  }

  /** Finishes the pass; the vertices are in `t`/`p` up to `count`. */
  end(): void {
    if (!this.passThrough && this.seen > 0) this.flushColumn();
  }

  private emit(time: number, price: number): void {
    if (this.count >= this.t.length) this.grow();
    this.t[this.count] = time;
    this.p[this.count] = price;
    this.count++;
  }

  private grow(): void {
    const t = new Float64Array(Math.max(16, this.t.length * 2));
    const p = new Float64Array(t.length);
    t.set(this.t);
    p.set(this.p);
    this.t = t;
    this.p = p;
  }

  private flushColumn(): void {
    this.emit(this.firstT, this.firstP);
    // Min and max in the order they happened, skipping ones already emitted.
    const minFirst = this.minI <= this.maxI;
    const aI = minFirst ? this.minI : this.maxI;
    const bI = minFirst ? this.maxI : this.minI;
    if (aI !== this.firstI && aI !== this.lastI) {
      this.emit(minFirst ? this.minT : this.maxT, minFirst ? this.minP : this.maxP);
    }
    if (bI !== this.firstI && bI !== this.lastI && bI !== aI) {
      this.emit(minFirst ? this.maxT : this.minT, minFirst ? this.maxP : this.minP);
    }
    if (this.lastI !== this.firstI) this.emit(this.lastT, this.lastP);
  }
}
