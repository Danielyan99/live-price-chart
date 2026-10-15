import { SIZE_DECIMALS, formatTimeUTC, splitDecimal } from "../lib/format.ts";
import { FLAG_BUY, FLAG_SIM } from "../lib/ringBuffer.ts";
import { setText } from "./dom.ts";
import type { FrameTask } from "./frameLoop.ts";
import type { ChartClock } from "./priceChart.ts";
import type { MarketStore } from "./store.ts";

export const TRADE_ROWS = 50;
/**
 * The table refreshes at most 10 times a second. Nobody can read rows that
 * change 60 times a second, and each DOM refresh costs layout and paint
 * (measured: at 400 trades/s on a 4x slower CPU, refreshing every frame was
 * the biggest cost after drawing). The chart still shows every trade.
 */
const MIN_INTERVAL_MS = 100;

interface Row {
  tr: HTMLTableRowElement;
  time: HTMLElement;
  side: HTMLElement;
  priceInt: HTMLElement;
  priceFrac: HTMLElement;
  sizeInt: HTMLElement;
  sizeFrac: HTMLElement;
  sizePad: HTMLElement;
}

function setAttr(el: HTMLElement, name: string, value: string | null): void {
  if (el.getAttribute(name) === value) return;
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/**
 * Last 50 trades. React renders a fixed pool of rows once; this task fills
 * them from the ring buffer, at most once per frame and only when a new
 * trade arrived (or the replay cursor moved). Text is only written when it
 * changed. Prices and sizes are split at the decimal point so the points
 * line up (see splitDecimal).
 */
export class TradesTable implements FrameTask {
  readonly name = "trades";
  private readonly store: MarketStore;
  private readonly clock: ChartClock;
  private rows: Row[] = [];
  private lastEnd = NaN;
  private lastResets = -1;
  private lastDraw = -Infinity;

  constructor(store: MarketStore, clock: ChartClock) {
    this.store = store;
    this.clock = clock;
  }

  mount(tbody: HTMLElement): void {
    const q = (tr: Element, sel: string) => tr.querySelector<HTMLElement>(sel)!;
    this.rows = Array.from(tbody.querySelectorAll("tr"), (tr) => ({
      tr,
      time: q(tr, ".t-time"),
      side: q(tr, ".t-side"),
      priceInt: q(tr, ".t-price .int"),
      priceFrac: q(tr, ".t-price .frac"),
      sizeInt: q(tr, ".t-size .int"),
      sizeFrac: q(tr, ".t-size .frac"),
      sizePad: q(tr, ".t-size .pad"),
    }));
    this.lastEnd = NaN;
  }

  unmount(): void {
    this.rows = [];
  }

  frame(now: number): void {
    if (this.rows.length === 0 || now - this.lastDraw < MIN_INTERVAL_MS) return;
    const pts = this.store.points;
    const limit = this.clock.limit();
    const n = Number.isFinite(limit) ? pts.upperBound(limit) : pts.length;
    // Absolute index of the newest row: unchanged means nothing to do.
    const end = pts.evicted + n;
    if (end === this.lastEnd && this.store.resets === this.lastResets) return;
    this.lastEnd = end;
    this.lastResets = this.store.resets;
    this.lastDraw = now;

    for (let r = 0; r < this.rows.length; r++) {
      const row = this.rows[r];
      const i = n - 1 - r;
      if (i < 0) {
        setAttr(row.tr, "hidden", "");
        continue;
      }
      setAttr(row.tr, "hidden", null);
      const flags = pts.flagsAt(i);
      const buy = (flags & FLAG_BUY) !== 0;
      setAttr(row.tr, "data-side", buy ? "buy" : "sell");
      setAttr(row.tr, "data-sim", flags & FLAG_SIM ? "" : null);
      setText(row.time, formatTimeUTC(pts.timeAt(i)));
      setText(row.side, buy ? "▲ Buy" : "▼ Sell");
      const price = splitDecimal(pts.priceAt(i), 2, false);
      setText(row.priceInt, price.int);
      setText(row.priceFrac, price.frac);
      const size = splitDecimal(pts.sizeAt(i), SIZE_DECIMALS);
      setText(row.sizeInt, size.int);
      setText(row.sizeFrac, size.frac);
      setText(row.sizePad, size.pad);
    }
  }
}
