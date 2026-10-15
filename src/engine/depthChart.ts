import type { DepthSnapshot } from "../feed/protocol.ts";
import { formatFixed, formatPrice, formatTimeUTC } from "../lib/format.ts";
import { cumulativeAt } from "../lib/orderBook.ts";
import { niceStep, priceTicks } from "../lib/ticks.ts";
import { COLORS, FONT, FONT_BOLD, Layer, crisp, pattern } from "./canvas.ts";
import type { FrameTask } from "./frameLoop.ts";

const M_LEFT = 6;
const M_RIGHT = 62;
const M_TOP = 28;
const M_BOTTOM = 20;

export interface DepthSource {
  /** Snapshot to show now (live, or recorded at the replay cursor). */
  depth(): DepthSnapshot | null;
  /** True when showing recorded data (replay). */
  recorded(): boolean;
  /** True when the live data is too old to call current. */
  stale(): boolean;
}

/**
 * Order-book depth: cumulative bid size to the left of the mid price,
 * cumulative ask size to the right. Bids and asks differ by fill texture
 * (diagonal lines vs dots) and by label, not only by colour. Redrawn only
 * when a new snapshot arrives, the size changes or the pointer moves.
 */
export class DepthChart implements FrameTask {
  readonly name = "depth";
  private readonly source: DepthSource;
  private readonly layer = new Layer("depth-canvas chart-input");
  private host: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private cssW = 0;
  private cssH = 0;
  private dirty = true;
  private shown: DepthSnapshot | null | undefined = undefined;
  private shownStale = false;
  private hover: { x: number; y: number } | null = null;

  constructor(source: DepthSource) {
    this.source = source;
  }

  mount(host: HTMLElement): void {
    this.host = host;
    host.append(this.layer.canvas);
    const c = this.layer.canvas;
    c.setAttribute("role", "img");
    c.setAttribute(
      "aria-label",
      "Order book depth chart: cumulative bids left of the mid price, asks right.",
    );
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerdown", this.onMove);
    c.addEventListener("pointerleave", this.onLeave);
    this.resizeObserver = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1].contentRect;
      this.cssW = Math.floor(box.width);
      this.cssH = Math.floor(box.height);
      this.dirty = true;
    });
    this.resizeObserver.observe(host);
  }

  unmount(): void {
    const c = this.layer.canvas;
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerdown", this.onMove);
    c.removeEventListener("pointerleave", this.onLeave);
    this.resizeObserver?.disconnect();
    c.remove();
    this.host = null;
  }

  private readonly onMove = (e: PointerEvent): void => {
    this.hover = { x: e.offsetX, y: e.offsetY };
    this.dirty = true;
  };

  private readonly onLeave = (): void => {
    this.hover = null;
    this.dirty = true;
  };

  frame(): void {
    if (!this.host) return;
    const dpr = window.devicePixelRatio || 1;
    if (this.layer.resize(Math.max(1, this.cssW), Math.max(1, this.cssH), dpr)) this.dirty = true;
    const d = this.source.depth();
    const stale = this.source.stale();
    if (d === this.shown && stale === this.shownStale && !this.dirty) return;
    this.shown = d;
    this.shownStale = stale;
    this.dirty = false;
    this.draw(d);
  }

  private draw(d: DepthSnapshot | null): void {
    const ctx = this.layer.begin();
    const dpr = this.layer.dpr;
    const w = this.layer.width;
    const h = this.layer.height;
    const plotW = Math.max(1, w - M_LEFT - M_RIGHT);
    const plotH = Math.max(1, h - M_TOP - M_BOTTOM);
    ctx.font = FONT;

    if (!d) {
      ctx.fillStyle = COLORS.axisText;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Waiting for the order book…", w / 2, h / 2);
      return;
    }

    const mid = (d.bestBid + d.bestAsk) / 2;
    const half = (mid * d.rangePct) / 100;
    const xMin = mid - half;
    const xMax = mid + half;
    const bidTotal = d.bidCum.length ? d.bidCum[d.bidCum.length - 1] : 0;
    const askTotal = d.askCum.length ? d.askCum[d.askCum.length - 1] : 0;
    const yTop = Math.max(bidTotal, askTotal, 1e-8) * 1.1;
    const xOf = (p: number) => M_LEFT + ((p - xMin) / (xMax - xMin)) * plotW;
    const yOf = (v: number) => M_TOP + plotH - (v / yTop) * plotH;
    const bottom = M_TOP + plotH;

    // Grid and axes.
    const xt = priceTicks(xMin, xMax, Math.max(2, Math.floor(plotW / 90)));
    const yt = priceTicks(0, yTop, Math.max(2, Math.floor(plotH / 36)), niceStep(yTop / 1e6).step);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    for (const v of yt.values) {
      const y = crisp(yOf(v), dpr);
      ctx.moveTo(M_LEFT, y);
      ctx.lineTo(M_LEFT + plotW, y);
    }
    ctx.stroke();
    ctx.fillStyle = COLORS.axisText;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const v of yt.values) {
      const y = yOf(v);
      if (y < M_TOP + 4) continue;
      ctx.fillText(formatFixed(v, yt.decimals), M_LEFT + plotW + 6, y);
    }
    ctx.textAlign = "center";
    for (const v of xt.values) {
      const x = xOf(v);
      if (x < M_LEFT + 24 || x > M_LEFT + plotW - 24) continue;
      ctx.fillText(formatFixed(v, xt.decimals), x, bottom + M_BOTTOM / 2 + 1);
    }
    ctx.textAlign = "left";
    ctx.fillText("BTC", M_LEFT + plotW + 6, M_TOP - 8);

    ctx.save();
    ctx.beginPath();
    ctx.rect(M_LEFT, M_TOP, plotW, plotH);
    ctx.clip();
    this.side(ctx, d.bidPrices, d.bidCum, d.bestBid, true, xOf, yOf, M_LEFT, bottom);
    this.side(ctx, d.askPrices, d.askCum, d.bestAsk, false, xOf, yOf, M_LEFT + plotW, bottom);
    // Mid price.
    ctx.strokeStyle = COLORS.crosshair;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(crisp(xOf(mid), dpr), M_TOP);
    ctx.lineTo(crisp(xOf(mid), dpr), bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Legend: texture swatch + word + arrow, so colour is never the only cue.
    const legend = (x: number, label: string, isBid: boolean, align: "left" | "right") => {
      ctx.font = FONT_BOLD;
      const tw = ctx.measureText(label).width;
      const sx = align === "left" ? x : x - tw - 18;
      ctx.fillStyle = pattern(
        ctx,
        isBid ? "forward" : "dots",
        isBid ? COLORS.up : COLORS.down,
        dpr,
        isBid ? 5 : 4,
      );
      ctx.fillRect(sx, 6, 12, 12);
      ctx.strokeStyle = isBid ? COLORS.up : COLORS.down;
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, 6.5, 11, 11);
      ctx.fillStyle = isBid ? COLORS.up : COLORS.down;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, sx + 18, 12.5);
    };
    legend(M_LEFT, "▲ Bids (buy orders)", true, "left");
    legend(M_LEFT + plotW, "Asks (sell orders) ▼", false, "right");

    const spread = d.bestAsk - d.bestBid;
    ctx.font = FONT;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      `spread ${formatFixed(spread, 2)} (${formatFixed((spread / mid) * 1e4, 2)} bp)`,
      M_LEFT + plotW / 2,
      M_TOP + 4,
    );
    ctx.fillStyle = d.source === "sim" ? COLORS.sim : COLORS.axisText;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const origin = this.source.recorded()
      ? `recorded book at ${formatTimeUTC(d.time, "s")} UTC`
      : d.source === "sim"
        ? "SIMULATED book"
        : "live book (Coinbase level2)";
    ctx.fillText(`${origin} · ±${formatFixed(d.rangePct, 1)} %`, M_LEFT + 4, bottom - 4);

    if (this.shownStale) {
      ctx.font = FONT_BOLD;
      ctx.fillStyle = COLORS.sim;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText("⚠ book not updating, may be out of date", M_LEFT + plotW - 4, bottom - 4);
    }
    this.drawHover(ctx, d, mid, xMin, xMax, plotW, plotH, xOf, yOf);
  }

  private side(
    ctx: CanvasRenderingContext2D,
    prices: Float64Array,
    cum: Float64Array,
    best: number,
    isBid: boolean,
    xOf: (p: number) => number,
    yOf: (v: number) => number,
    edgeX: number,
    bottom: number,
  ): void {
    if (prices.length === 0) return;
    const dpr = this.layer.dpr;
    const color = isBid ? COLORS.up : COLORS.down;
    const path = new Path2D();
    path.moveTo(xOf(best), bottom);
    let y = bottom;
    for (let i = 0; i < prices.length; i++) {
      const x = xOf(prices[i]);
      path.lineTo(x, y);
      y = yOf(cum[i]);
      path.lineTo(x, y);
    }
    path.lineTo(edgeX, y);
    const area = new Path2D(path);
    area.lineTo(edgeX, bottom);
    area.closePath();
    ctx.fillStyle = isBid ? "rgba(47,191,113,0.10)" : "rgba(240,97,109,0.10)";
    ctx.fill(area);
    ctx.fillStyle = pattern(
      ctx,
      isBid ? "forward" : "dots",
      isBid ? "rgba(47,191,113,0.5)" : "rgba(240,97,109,0.6)",
      dpr,
      isBid ? 7 : 5,
    );
    ctx.fill(area);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke(path);
  }

  private drawHover(
    ctx: CanvasRenderingContext2D,
    d: DepthSnapshot,
    mid: number,
    xMin: number,
    xMax: number,
    plotW: number,
    plotH: number,
    xOf: (p: number) => number,
    yOf: (v: number) => number,
  ): void {
    const hv = this.hover;
    if (!hv || hv.x < M_LEFT || hv.x > M_LEFT + plotW || hv.y < M_TOP || hv.y > M_TOP + plotH)
      return;
    const dpr = this.layer.dpr;
    const price = xMin + ((hv.x - M_LEFT) / plotW) * (xMax - xMin);
    const isBid = price < mid;
    const total = isBid
      ? cumulativeAt(d.bidPrices, d.bidCum, price, true)
      : cumulativeAt(d.askPrices, d.askCum, price, false);
    const x = crisp(xOf(price), dpr);
    const y = crisp(yOf(total), dpr);
    ctx.strokeStyle = COLORS.crosshair;
    ctx.lineWidth = 1 / dpr;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, M_TOP);
    ctx.lineTo(x, M_TOP + plotH);
    ctx.moveTo(M_LEFT, y);
    ctx.lineTo(M_LEFT + plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    const lines = [
      `${formatPrice(price)} USD`,
      `${formatFixed(total, 4)} BTC ${isBid ? "bid at ≥ this price" : "ask at ≤ this price"}`,
      `${formatFixed((Math.abs(price - mid) / mid) * 100, 3)} % from mid`,
    ];
    ctx.font = FONT;
    let tw = 0;
    for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width);
    const bw = tw + 14;
    const bh = lines.length * 14 + 8;
    let bx = hv.x + 12;
    if (bx + bw > M_LEFT + plotW) bx = hv.x - 12 - bw;
    const by = Math.max(M_TOP, Math.min(hv.y - bh / 2, M_TOP + plotH - bh));
    ctx.fillStyle = COLORS.tooltipBg;
    ctx.strokeStyle = COLORS.tooltipBorder;
    ctx.beginPath();
    ctx.roundRect(Math.max(2, bx), by, bw, bh, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, Math.max(2, bx) + 7, by + 5 + i * 14));
  }
}
