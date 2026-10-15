import { MinMaxDownsampler } from "../lib/downsample.ts";
import {
  SIZE_DECIMALS,
  formatCount,
  formatFixed,
  formatPrice,
  formatTimeUTC,
} from "../lib/format.ts";
import { FLAG_BUY, FLAG_SIM } from "../lib/ringBuffer.ts";
import { formatTimeTick, priceTicks, timeTicks } from "../lib/ticks.ts";
import { COLORS, FONT, FONT_BOLD, Layer, crisp, pattern, tag, triangle } from "./canvas.ts";
import type { FrameTask } from "./frameLoop.ts";
import { Observable } from "./observable.ts";
import type { MarketStore } from "./store.ts";

/** Where "now" is for the chart: live time, or the replay cursor. */
export interface ChartClock {
  /** Right edge of the view while following (exchange clock, ms). */
  head(): number;
  /** The market state is known up to this time; the line is drawn up to it. */
  knownUntil(): number;
  /** Only points at or before this time exist for the chart (replay). */
  limit(): number;
}

export const RANGE_PRESETS = [
  { label: "1m", ms: 60_000 },
  { label: "5m", ms: 5 * 60_000 },
  { label: "15m", ms: 15 * 60_000 },
  { label: "1h", ms: 60 * 60_000 },
  { label: "All", ms: Infinity },
] as const;
export type RangeLabel = (typeof RANGE_PRESETS)[number]["label"];

export interface ChartViewState {
  follow: boolean;
  preset: RangeLabel | null;
}

const AXIS_W = 92;
const AXIS_H = 22;
const PAD_TOP = 8;
const MIN_SPAN_MS = 500;
const MAX_SPAN_MS = 24 * 3_600_000;
/** Smallest price range on the y axis (USD), so a flat market is not blown up. */
const MIN_Y_SPAN = 1;
const Y_PAD = 0.08;
const LINE_W = 1.5;

function growRects(old: Float64Array<ArrayBuffer>): Float64Array<ArrayBuffer> {
  const next = new Float64Array(Math.max(1024, old.length * 2));
  next.set(old);
  return next;
}

const clampSpan = (ms: number) => Math.min(MAX_SPAN_MS, Math.max(MIN_SPAN_MS, ms));

type Gesture =
  | { kind: "pan"; startX: number; xMin0: number; xMax0: number; moved: boolean }
  | { kind: "pinch"; d0: number; anchor: number; xMin0: number; xMax0: number };

/**
 * The price chart: three stacked canvases.
 * - grid: background, grid lines and axis labels. Redrawn only when the
 *   scales or the size change, so a crosshair move or a paused view costs
 *   nothing here.
 * - series: the price line (min/max downsampled), simulated-data bands and
 *   the last-price marker.
 * - overlay: the crosshair and tooltip; also receives all input.
 * All drawing happens in frame(), called by the single animation loop.
 */
export class PriceChart implements FrameTask {
  readonly name = "chart";
  readonly view = new Observable<ChartViewState>({ follow: true, preset: "15m" });
  /** Raw points in view, and vertices drawn after downsampling. */
  pointsInView = 0;
  vertices = 0;
  /** Grid layer redraws, to show the cache working. */
  gridDraws = 0;

  private readonly store: MarketStore;
  private readonly clock: ChartClock;
  private host: HTMLElement | null = null;
  private readonly gridLayer = new Layer("chart-layer", true);
  private readonly seriesLayer = new Layer("chart-layer");
  private readonly overlayLayer = new Layer("chart-layer chart-input");
  private readonly ds = new MinMaxDownsampler();
  private resizeObserver: ResizeObserver | null = null;
  private cssW = 0;
  private cssH = 0;
  private sizeDirty = true;

  private follow = true;
  private fitAll = false;
  private span = 15 * 60_000;
  private xMin = 0;
  private xMax = 1;
  private yMin = 0;
  private yMax = 1;
  private plotW = 1;
  private plotH = 1;
  private i0 = 0;
  private i1 = 0;
  private nLimit = 0;
  private lineEnd = NaN;
  private hasData = false;
  private bands: number[] = [];
  /** Reused rectangle list for the dense drawing path (x, y, w, h). */
  private rects: Float64Array<ArrayBuffer> = new Float64Array(4096);
  private readonly seriesKey = new Float64Array(9).fill(NaN);
  private readonly gridKey = new Float64Array(7).fill(NaN);

  private hover: { x: number; y: number } | null = null;
  private overlayDirty = true;
  /** False while the overlay canvas is known to be empty (skip clearing it). */
  private overlayDrawn = true;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;

  constructor(store: MarketStore, clock: ChartClock) {
    this.store = store;
    this.clock = clock;
  }

  // ---- Mounting ---------------------------------------------------------

  mount(host: HTMLElement): void {
    this.host = host;
    host.append(this.gridLayer.canvas, this.seriesLayer.canvas, this.overlayLayer.canvas);
    const input = this.overlayLayer.canvas;
    input.tabIndex = 0;
    input.setAttribute("role", "img");
    input.setAttribute(
      "aria-label",
      "BTC-USD price chart. Drag or arrow keys to pan, mouse wheel, pinch or plus and minus to zoom, End to follow live, Home to show all.",
    );
    input.addEventListener("pointerdown", this.onPointerDown);
    input.addEventListener("pointermove", this.onPointerMove);
    input.addEventListener("pointerup", this.onPointerUp);
    input.addEventListener("pointercancel", this.onPointerUp);
    input.addEventListener("pointerleave", this.onPointerLeave);
    input.addEventListener("wheel", this.onWheel, { passive: false });
    input.addEventListener("dblclick", this.goLive);
    input.addEventListener("keydown", this.onKeyDown);
    this.resizeObserver = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1].contentRect;
      this.cssW = Math.floor(box.width);
      this.cssH = Math.floor(box.height);
      this.sizeDirty = true;
    });
    this.resizeObserver.observe(host);
  }

  unmount(): void {
    const input = this.overlayLayer.canvas;
    input.removeEventListener("pointerdown", this.onPointerDown);
    input.removeEventListener("pointermove", this.onPointerMove);
    input.removeEventListener("pointerup", this.onPointerUp);
    input.removeEventListener("pointercancel", this.onPointerUp);
    input.removeEventListener("pointerleave", this.onPointerLeave);
    input.removeEventListener("wheel", this.onWheel);
    input.removeEventListener("dblclick", this.goLive);
    input.removeEventListener("keydown", this.onKeyDown);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.gridLayer.canvas.remove();
    this.seriesLayer.canvas.remove();
    this.overlayLayer.canvas.remove();
    this.host = null;
  }

  // ---- View control (also used by the toolbar) --------------------------

  setPreset(label: RangeLabel): void {
    const preset = RANGE_PRESETS.find((p) => p.label === label);
    if (!preset) return;
    this.follow = true;
    this.fitAll = preset.ms === Infinity;
    if (!this.fitAll) this.span = preset.ms;
    this.publish();
  }

  readonly goLive = (): void => {
    this.follow = true;
    this.publish();
  };

  zoom(factor: number, anchorX?: number): void {
    if (this.follow) {
      this.fitAll = false;
      this.span = clampSpan(this.span * factor);
      this.publish();
      return;
    }
    const anchor = anchorX === undefined ? (this.xMin + this.xMax) / 2 : this.timeAtX(anchorX);
    const span = clampSpan((this.xMax - this.xMin) * factor);
    const frac = (anchor - this.xMin) / (this.xMax - this.xMin);
    this.setView(anchor - frac * span, anchor + (1 - frac) * span);
  }

  /** Moves the view by a fraction of its width (negative = back in time). */
  pan(fraction: number): void {
    const dt = (this.xMax - this.xMin) * fraction;
    this.setView(this.xMin + dt, this.xMax + dt);
  }

  private setView(xMin: number, xMax: number): void {
    const span = clampSpan(xMax - xMin);
    const head = this.clock.head();
    this.fitAll = false;
    if (xMax >= head) {
      // Panned or zoomed up to "now": snap back to following.
      this.follow = true;
      this.span = span;
    } else {
      // Keep some data in view so the user cannot get lost in empty space.
      const first = this.store.points.firstTime;
      if (Number.isFinite(first) && xMax < first + span * 0.2) xMax = first + span * 0.2;
      this.follow = false;
      this.xMax = xMax;
      this.xMin = xMax - span;
      this.span = span;
    }
    this.publish();
  }

  private publish(): void {
    const preset = this.fitAll
      ? "All"
      : (RANGE_PRESETS.find((p) => p.ms === this.span)?.label ?? null);
    this.view.set({ follow: this.follow, preset });
  }

  // ---- Frame ------------------------------------------------------------

  frame(): void {
    if (!this.host) return;
    this.syncSize();
    const pts = this.store.points;
    const limit = this.clock.limit();
    const head = this.clock.head();
    this.nLimit = Number.isFinite(limit) ? pts.upperBound(limit) : pts.length;
    if (this.fitAll && this.nLimit > 0) this.span = clampSpan((head - pts.firstTime) * 1.02);
    if (this.follow) {
      this.xMax = head;
      this.xMin = head - this.span;
    }
    this.i0 = Math.max(0, pts.lowerBound(this.xMin) - 1);
    this.i1 = Math.min(this.nLimit, pts.upperBound(this.xMax) + 1);
    const known = Math.min(this.clock.knownUntil(), this.xMax);

    const k = this.seriesKey;
    const base = pts.evicted;
    const changed =
      this.sizeDirty ||
      !this.hasData ||
      k[0] !== this.xMin ||
      k[1] !== this.xMax ||
      k[2] !== base + this.i0 ||
      k[3] !== base + this.i1 ||
      k[4] !== known ||
      k[5] !== this.store.resets ||
      k[6] !== this.plotW ||
      k[7] !== this.plotH ||
      k[8] !== this.seriesLayer.dpr;
    if (changed) {
      k[0] = this.xMin;
      k[1] = this.xMax;
      k[2] = base + this.i0;
      k[3] = base + this.i1;
      k[4] = known;
      k[5] = this.store.resets;
      k[6] = this.plotW;
      k[7] = this.plotH;
      k[8] = this.seriesLayer.dpr;
      this.computeSeries(known);
      this.drawGridIfNeeded();
      this.drawSeries();
      this.overlayDirty = true;
      this.sizeDirty = false;
    }
    if (this.overlayDirty) {
      this.drawOverlay();
      this.overlayDirty = false;
    }
  }

  private syncSize(): void {
    const dpr = window.devicePixelRatio || 1;
    if (!this.sizeDirty && dpr === this.seriesLayer.dpr) return;
    const w = Math.max(1, this.cssW);
    const h = Math.max(1, this.cssH);
    this.gridLayer.resize(w, h, dpr);
    this.seriesLayer.resize(w, h, dpr);
    if (this.overlayLayer.resize(w, h, dpr)) this.overlayDrawn = true;
    this.plotW = Math.max(1, w - AXIS_W);
    this.plotH = Math.max(1, h - AXIS_H - PAD_TOP);
    this.sizeDirty = true;
  }

  private xOf(t: number): number {
    return ((t - this.xMin) / (this.xMax - this.xMin)) * this.plotW;
  }

  private yOf(p: number): number {
    return PAD_TOP + ((this.yMax - p) / (this.yMax - this.yMin)) * this.plotH;
  }

  private timeAtX(x: number): number {
    return this.xMin + (x / this.plotW) * (this.xMax - this.xMin);
  }

  /** Downsamples the visible points, finds simulated bands and the y range. */
  private computeSeries(known: number): void {
    const pts = this.store.points;
    const ds = this.ds;
    ds.begin(this.xMin, this.xMax, Math.floor(this.plotW), this.i1 - this.i0);
    const T = pts.time;
    const P = pts.price;
    pts.segments(this.i0, this.i1, (start, end) => ds.addRange(T, P, start, end));
    ds.end();

    const atNewest = this.i1 > 0 && this.i1 === this.nLimit;
    // The line runs on to the time we know the price for (it is a step
    // line: the price stays at the last trade). After that: a gap, which is
    // how a stalled feed looks on screen.
    this.lineEnd = atNewest ? Math.max(known, pts.timeAt(this.i1 - 1)) : NaN;
    const dataEnd = this.i1 > 0 ? (atNewest ? this.lineEnd : pts.timeAt(this.i1 - 1)) : this.xMin;
    this.bands = this.store.simBands(this.xMin, Math.min(this.xMax, dataEnd));
    this.pointsInView = ds.inView;
    this.vertices = ds.count;

    let lo = ds.min;
    let hi = ds.max;
    // The step line shows the price of the last trade before the view at
    // the left edge, so that price belongs in the y range too.
    if (this.i0 < this.i1 && pts.timeAt(this.i0) < this.xMin) {
      const edge = pts.priceAt(this.i0);
      if (!(edge >= lo)) lo = edge;
      if (!(edge <= hi)) hi = edge;
    }
    this.hasData = hi >= lo;
    if (!this.hasData) return;
    let span = hi - lo;
    if (span < MIN_Y_SPAN) {
      const mid = (hi + lo) / 2;
      lo = mid - MIN_Y_SPAN / 2;
      hi = mid + MIN_Y_SPAN / 2;
      span = MIN_Y_SPAN;
    }
    this.yMin = lo - span * Y_PAD;
    this.yMax = hi + span * Y_PAD;
  }

  private drawGridIfNeeded(): void {
    const g = this.gridKey;
    const dpr = this.gridLayer.dpr;
    if (
      g[0] === this.xMin &&
      g[1] === this.xMax &&
      g[2] === this.yMin &&
      g[3] === this.yMax &&
      g[4] === this.plotW &&
      g[5] === this.plotH &&
      g[6] === dpr
    ) {
      return;
    }
    g[0] = this.xMin;
    g[1] = this.xMax;
    g[2] = this.yMin;
    g[3] = this.yMax;
    g[4] = this.plotW;
    g[5] = this.plotH;
    g[6] = dpr;
    this.gridDraws++;

    const ctx = this.gridLayer.begin();
    const { plotW, plotH } = this;
    const bottom = PAD_TOP + plotH;
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(0, 0, this.gridLayer.width, this.gridLayer.height);
    ctx.font = FONT;
    ctx.textBaseline = "middle";

    // Time ticks: fewer when labels are long (milliseconds).
    let tt = timeTicks(this.xMin, this.xMax, Math.max(2, Math.floor(plotW / 80)));
    if (tt.precision === "ms")
      tt = timeTicks(this.xMin, this.xMax, Math.max(2, Math.floor(plotW / 110)));
    const pt = this.hasData
      ? priceTicks(this.yMin, this.yMax, Math.max(2, Math.floor(plotH / 44)))
      : null;

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    for (const v of tt.values) {
      const x = crisp(this.xOf(v), dpr);
      ctx.moveTo(x, PAD_TOP);
      ctx.lineTo(x, bottom);
    }
    if (pt) {
      for (const v of pt.values) {
        const y = crisp(this.yOf(v), dpr);
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
      }
    }
    ctx.stroke();

    ctx.strokeStyle = COLORS.axisLine;
    ctx.beginPath();
    const ax = crisp(plotW, dpr);
    const ay = crisp(bottom, dpr);
    ctx.moveTo(ax, PAD_TOP);
    ctx.lineTo(ax, ay);
    ctx.lineTo(0, ay);
    ctx.stroke();

    ctx.fillStyle = COLORS.axisText;
    ctx.textAlign = "center";
    for (const v of tt.values) {
      const x = this.xOf(v);
      if (x < 28 || x > plotW - 28) continue;
      ctx.fillText(formatTimeTick(v, tt.precision), x, bottom + AXIS_H / 2 + 1);
    }
    ctx.textAlign = "left";
    if (pt) {
      for (const v of pt.values) {
        const y = this.yOf(v);
        if (y < PAD_TOP + 6 || y > bottom - 6) continue;
        ctx.fillText(formatFixed(v, pt.decimals), plotW + 8, y);
      }
    }
    ctx.fillText("UTC", plotW + 8, bottom + AXIS_H / 2 + 1);
  }

  private drawSeries(): void {
    const ctx = this.seriesLayer.begin();
    const { plotW, plotH } = this;
    const dpr = this.seriesLayer.dpr;

    if (!this.hasData) {
      ctx.fillStyle = COLORS.axisText;
      ctx.font = FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const s = this.store.status;
      const msg =
        s?.backfill === "loading"
          ? "Loading recent trades from Coinbase…"
          : this.store.points.length > 0
            ? "No trades in this time range"
            : "Waiting for data…";
      ctx.fillText(msg, plotW / 2, PAD_TOP + plotH / 2);
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, PAD_TOP, plotW, plotH);
    ctx.clip();

    // Simulated data is never shown as real: hatched band and a label.
    const bands = this.bands;
    for (let b = 0; b < bands.length; b += 2) {
      const x0 = Math.max(0, this.xOf(bands[b]));
      const x1 = Math.min(plotW, this.xOf(bands[b + 1]));
      if (x1 - x0 < 1) continue;
      ctx.fillStyle = pattern(ctx, "backward", "rgba(242,184,75,0.22)", dpr, 8);
      ctx.fillRect(x0, PAD_TOP, x1 - x0, plotH);
      if (x1 - x0 > 84) {
        ctx.fillStyle = COLORS.sim;
        ctx.font = FONT_BOLD;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("SIMULATED", x0 + 6, PAD_TOP + 6);
      }
    }

    const endX = this.ds.aggregated ? this.drawColumns(ctx) : this.drawStepPath(ctx);
    ctx.restore();

    if (Number.isFinite(this.lineEnd)) this.drawLastPrice(ctx, endX);
  }

  /** Sparse view (no more points than pixels): the exact step line. Returns its end x. */
  private drawStepPath(ctx: CanvasRenderingContext2D): number {
    const { t, p, count } = this.ds;
    const bottom = PAD_TOP + this.plotH;
    const sx = this.plotW / (this.xMax - this.xMin);
    const sy = this.plotH / (this.yMax - this.yMin);
    const x0 = this.xMin;
    const y0 = this.yMax;
    const line = new Path2D();
    const firstX = (t[0] - x0) * sx;
    let py = PAD_TOP + (y0 - p[0]) * sy;
    line.moveTo(firstX, py);
    let lastX = firstX;
    for (let k = 1; k < count; k++) {
      const x = (t[k] - x0) * sx;
      const y = PAD_TOP + (y0 - p[k]) * sy;
      line.lineTo(x, py);
      line.lineTo(x, y);
      py = y;
      lastX = x;
    }
    if (Number.isFinite(this.lineEnd)) {
      lastX = (this.lineEnd - x0) * sx;
      line.lineTo(lastX, py);
    }
    const area = new Path2D(line);
    area.lineTo(lastX, bottom);
    area.lineTo(firstX, bottom);
    area.closePath();
    ctx.fillStyle = COLORS.lineFill;
    ctx.fill(area);
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = LINE_W;
    ctx.lineJoin = "miter"; // a step line only has right angles
    ctx.stroke(line);
    return lastX;
  }

  /**
   * Dense view (more points than pixels): one bar per pixel column, from the
   * column's lowest to highest price, including the step in from the
   * previous price; flat runs between columns are thin horizontal bars.
   * These are exactly the pixels the step line through the min/max vertices
   * covers, but drawn as a few hundred plain rectangles instead of stroking
   * one long self-overlapping path. Measured: stroking that path was the
   * main frame cost in Chrome (GPU stroker), not the JavaScript.
   * Returns the end x of the line.
   */
  private drawColumns(ctx: CanvasRenderingContext2D): number {
    const { t, p, count } = this.ds;
    const bottom = PAD_TOP + this.plotH;
    const sx = this.plotW / (this.xMax - this.xMin);
    const sy = this.plotH / (this.yMax - this.yMin);
    const x0 = this.xMin;
    const y0 = this.yMax;
    const yOf = (price: number) => PAD_TOP + (y0 - price) * sy;
    const half = LINE_W / 2;
    const rects = this.rects;
    let n = 0;
    const push = (x: number, y: number, w: number, h: number) => {
      if (n + 4 > rects.length) this.rects = growRects(this.rects);
      const r = this.rects;
      r[n] = x;
      r[n + 1] = y;
      r[n + 2] = w;
      r[n + 3] = h;
      n += 4;
    };
    const bar = (col: number, lo: number, hi: number) => {
      const top = yOf(hi);
      push(col, top - half, LINE_W, yOf(lo) - top + LINE_W);
    };
    const flat = (xa: number, xb: number, price: number) => {
      push(xa, yOf(price) - half, xb - xa + half, LINE_W);
    };

    // The area under the line: one vertex per column edge, at the price the
    // line has there. Simple shape, cheap to fill.
    const area = new Path2D();
    let col = Math.floor((t[0] - x0) * sx);
    const firstX = col;
    let lo = p[0];
    let hi = p[0];
    area.moveTo(col, yOf(p[0]));
    for (let k = 1; k < count; k++) {
      const c = Math.floor((t[k] - x0) * sx);
      if (c !== col) {
        const prev = p[k - 1];
        bar(col, lo, hi);
        area.lineTo(col + 1, yOf(prev));
        if (c > col + 1) flat(col + 1, c, prev);
        area.lineTo(c, yOf(prev));
        col = c;
        lo = hi = prev; // the step at this vertex starts from the previous price
      }
      const q = p[k];
      if (q < lo) lo = q;
      if (q > hi) hi = q;
    }
    bar(col, lo, hi);
    const last = p[count - 1];
    let endX = col + 1;
    area.lineTo(endX, yOf(last));
    if (Number.isFinite(this.lineEnd)) {
      const xe = (this.lineEnd - x0) * sx;
      if (xe > endX) {
        flat(endX, xe, last);
        endX = xe;
        area.lineTo(endX, yOf(last));
      }
    }
    area.lineTo(endX, bottom);
    area.lineTo(firstX, bottom);
    area.closePath();
    ctx.fillStyle = COLORS.lineFill;
    ctx.fill(area);
    ctx.fillStyle = COLORS.line;
    const r = this.rects;
    for (let i = 0; i < n; i += 4) ctx.fillRect(r[i], r[i + 1], r[i + 2], r[i + 3]);
    return endX;
  }

  /** Last trade price: dashed line plus an axis tag with ▲/▼ (tick direction). */
  private drawLastPrice(ctx: CanvasRenderingContext2D, endX: number): void {
    const pts = this.store.points;
    const n = this.nLimit;
    const last = pts.priceAt(n - 1);
    // Tick direction: compare with the last different price.
    let dir = 0;
    for (let i = n - 2; i >= Math.max(0, n - 200); i--) {
      const q = pts.priceAt(i);
      if (q !== last) {
        dir = last > q ? 1 : -1;
        break;
      }
    }
    const y = this.yOf(last);
    if (y < PAD_TOP || y > PAD_TOP + this.plotH) return;
    const color = dir > 0 ? COLORS.up : dir < 0 ? COLORS.down : COLORS.flat;
    const dpr = this.seriesLayer.dpr;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1 / dpr;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.max(0, endX), crisp(y, dpr));
    ctx.lineTo(this.plotW, crisp(y, dpr));
    ctx.stroke();
    ctx.restore();
    ctx.font = FONT_BOLD;
    const arrow = dir > 0 ? "▲" : dir < 0 ? "▼" : "•";
    tag(ctx, `${arrow} ${formatPrice(last)}`, this.plotW + 2, y, color, "#0b0f14");
  }

  private drawOverlay(): void {
    const h = this.hover;
    const { plotW, plotH } = this;
    const visible =
      h !== null &&
      this.hasData &&
      this.gesture?.kind !== "pinch" &&
      h.x >= 0 &&
      h.x <= plotW &&
      h.y >= PAD_TOP &&
      h.y <= PAD_TOP + plotH;
    // An empty overlay stays empty: no clear, no repaint of a full-size layer.
    if (!visible && !this.overlayDrawn) return;
    const ctx = this.overlayLayer.begin();
    this.overlayDrawn = false;
    if (!h || !visible) return;
    const pts = this.store.points;
    const n = this.nLimit;
    if (n === 0) return;

    // Snap to the nearest trade in time.
    const tc = this.timeAtX(h.x);
    let j = Math.min(pts.lowerBound(tc), n);
    if (j === n || (j > 0 && tc - pts.timeAt(j - 1) < pts.timeAt(j) - tc)) j--;
    const t = pts.timeAt(j);
    const price = pts.priceAt(j);
    const size = pts.sizeAt(j);
    const flags = pts.flagsAt(j);
    const x = this.xOf(t);
    const y = this.yOf(price);
    if (x < 0 || x > plotW) return;
    this.overlayDrawn = true;
    const dpr = this.overlayLayer.dpr;
    const buy = (flags & FLAG_BUY) !== 0;

    ctx.save();
    ctx.strokeStyle = COLORS.crosshair;
    ctx.lineWidth = 1 / dpr;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(crisp(x, dpr), PAD_TOP);
    ctx.lineTo(crisp(x, dpr), PAD_TOP + plotH);
    ctx.moveTo(0, crisp(y, dpr));
    ctx.lineTo(plotW, crisp(y, dpr));
    ctx.stroke();
    ctx.restore();

    triangle(ctx, x, y, 5, buy);
    ctx.fillStyle = buy ? COLORS.up : COLORS.down;
    ctx.fill();
    ctx.strokeStyle = "#0b0f14";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = FONT;
    tag(ctx, formatPrice(price), plotW + 2, y, "#2b3746", COLORS.text);
    const timeText = formatTimeUTC(t);
    const tw = ctx.measureText(timeText).width + 10;
    const tx = Math.min(plotW - tw / 2, Math.max(tw / 2, x));
    tag(ctx, timeText, tx, PAD_TOP + plotH + AXIS_H / 2, "#2b3746", COLORS.text, "center");

    const lines = [
      `${formatTimeUTC(t)} UTC`,
      `${formatPrice(price)} USD`,
      `${formatFixed(size, SIZE_DECIMALS)} BTC`,
      `${buy ? "▲ Buy" : "▼ Sell"} (taker)${flags & FLAG_SIM ? " · SIMULATED" : ""}`,
    ];
    // More than one trade under this pixel: say so, with the real range.
    const colStart = this.timeAtX(Math.floor(x));
    const colEnd = this.timeAtX(Math.floor(x) + 1);
    const a = pts.lowerBound(colStart);
    const b = Math.min(n, pts.lowerBound(colEnd));
    if (b - a > 1) {
      let lo = Infinity;
      let hi = -Infinity;
      const scanEnd = Math.min(b, a + 200_000);
      for (let i = a; i < scanEnd; i++) {
        const q = pts.priceAt(i);
        if (q < lo) lo = q;
        if (q > hi) hi = q;
      }
      lines.push(
        `${formatCount(b - a)} trades in this pixel`,
        `${formatPrice(lo)} – ${formatPrice(hi)}`,
      );
    }
    this.drawTooltip(ctx, lines, h.x, h.y);
  }

  private drawTooltip(
    ctx: CanvasRenderingContext2D,
    lines: string[],
    cx: number,
    cy: number,
  ): void {
    ctx.font = FONT;
    let w = 0;
    for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
    w += 16;
    const lh = 15;
    const h = lines.length * lh + 10;
    let x = cx + 14;
    if (x + w > this.plotW) x = cx - 14 - w;
    let y = cy + 14;
    if (y + h > PAD_TOP + this.plotH) y = cy - 14 - h;
    x = Math.max(2, x);
    y = Math.max(PAD_TOP, y);
    ctx.fillStyle = COLORS.tooltipBg;
    ctx.strokeStyle = COLORS.tooltipBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, x + 8, y + 6 + i * lh));
  }

  // ---- Input ------------------------------------------------------------

  private readonly onPointerDown = (e: PointerEvent): void => {
    const input = this.overlayLayer.canvas;
    input.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (this.pointers.size === 1) {
      this.gesture = {
        kind: "pan",
        startX: e.offsetX,
        xMin0: this.xMin,
        xMax0: this.xMax,
        moved: false,
      };
      this.hover = { x: e.offsetX, y: e.offsetY };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = {
        kind: "pinch",
        d0: Math.max(10, Math.abs(a.x - b.x)),
        anchor: this.timeAtX((a.x + b.x) / 2),
        xMin0: this.xMin,
        xMax0: this.xMax,
      };
    }
    this.overlayDirty = true;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = e.offsetX;
      p.y = e.offsetY;
    }
    const g = this.gesture;
    if (g?.kind === "pan" && p) {
      const dx = e.offsetX - g.startX;
      if (g.moved || Math.abs(dx) > 3) {
        g.moved = true;
        const dt = (dx / this.plotW) * (g.xMax0 - g.xMin0);
        this.setView(g.xMin0 - dt, g.xMax0 - dt);
      }
    } else if (g?.kind === "pinch" && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.max(10, Math.abs(a.x - b.x));
      const span0 = g.xMax0 - g.xMin0;
      const span = clampSpan(span0 * (g.d0 / d));
      const frac = (g.anchor - g.xMin0) / span0;
      this.setView(g.anchor - frac * span, g.anchor + (1 - frac) * span);
    }
    this.hover = { x: e.offsetX, y: e.offsetY };
    this.overlayDirty = true;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      this.gesture = null;
    } else if (this.pointers.size === 1) {
      const [rest] = [...this.pointers.values()];
      this.gesture = {
        kind: "pan",
        startX: rest.x,
        xMin0: this.xMin,
        xMax0: this.xMax,
        moved: true,
      };
    }
    this.overlayDirty = true;
  };

  private readonly onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") {
      this.hover = null;
      this.overlayDirty = true;
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    this.zoom(Math.exp(delta * 0.0015), e.offsetX);
    this.hover = { x: e.offsetX, y: e.offsetY };
    this.overlayDirty = true;
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    let handled = true;
    switch (e.key) {
      case "ArrowLeft":
        this.pan(-0.2);
        break;
      case "ArrowRight":
        this.pan(0.2);
        break;
      case "+":
      case "=":
        this.zoom(1 / 1.25);
        break;
      case "-":
      case "_":
        this.zoom(1.25);
        break;
      case "End":
        this.goLive();
        break;
      case "Home":
        this.setPreset("All");
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };
}
