import { formatCount, formatFixed, formatMB } from "../lib/format.ts";
import { COLORS, FONT, Layer, crisp, pattern } from "./canvas.ts";
import type { FrameLoop, FrameTask } from "./frameLoop.ts";
import { FRAME_BUDGET_MS } from "./perfStats.ts";
import type { PriceChart } from "./priceChart.ts";
import type { MarketStore } from "./store.ts";

const BARS = 120;
/** Top of the sparkline scale; the budget line sits at 2/3 height. */
const SCALE_MS = 25;
const TEXT_EVERY_MS = 250;

interface PerfMemory {
  usedJSHeapSize: number;
}

/**
 * Frame-budget panel. The sparkline (draw time of each of the last 120
 * frames, against the 16.7 ms line) is drawn on canvas every frame; the text
 * fields are plain DOM updated 4 times a second, only when their text
 * changes. No React state is involved.
 */
export class PerfPanel implements FrameTask {
  readonly name = "perf panel";
  private readonly loop: FrameLoop;
  private readonly store: MarketStore;
  private readonly chart: PriceChart;
  private readonly spark = new Layer("spark");
  private readonly fields = new Map<string, HTMLElement>();
  private root: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private sparkW = 0;
  private sparkH = 0;
  private lastText = 0;
  private lastSecond = 0;
  private ingestPerSec = 0;

  constructor(loop: FrameLoop, store: MarketStore, chart: PriceChart) {
    this.loop = loop;
    this.store = store;
    this.chart = chart;
  }

  mount(root: HTMLElement): void {
    this.root = root;
    for (const el of root.querySelectorAll<HTMLElement>("[data-perf]")) {
      this.fields.set(el.dataset.perf ?? "", el);
    }
    const holder = root.querySelector<HTMLElement>("[data-spark]");
    if (holder) {
      holder.append(this.spark.canvas);
      this.resizeObserver = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1].contentRect;
        this.sparkW = Math.floor(box.width);
        this.sparkH = Math.floor(box.height);
      });
      this.resizeObserver.observe(holder);
    }
  }

  unmount(): void {
    this.resizeObserver?.disconnect();
    this.spark.canvas.remove();
    this.fields.clear();
    this.root = null;
  }

  frame(now: number): void {
    if (!this.root) return;
    this.drawSpark();
    if (now - this.lastSecond >= 1000) {
      this.ingestPerSec = (this.store.ingestMs * 1000) / Math.max(1, now - this.lastSecond);
      this.store.ingestMs = 0;
      this.lastSecond = now;
    }
    if (now - this.lastText < TEXT_EVERY_MS) return;
    this.lastText = now;
    this.updateText();
  }

  private set(key: string, text: string, state?: "ok" | "warn"): void {
    const el = this.fields.get(key);
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    if (state !== undefined && el.dataset.state !== state) el.dataset.state = state;
  }

  private updateText(): void {
    const perf = this.loop.perf;
    const s = perf.summary(BARS);
    const fps = perf.fps();
    const status = this.store.status;
    const pts = this.store.points;

    this.set("fps", formatFixed(fps, 0), fps >= 55 ? "ok" : "warn");
    this.set("avg", `${formatFixed(s.avg, 2)} ms`, s.avg <= FRAME_BUDGET_MS ? "ok" : "warn");
    this.set("p95", `${formatFixed(s.p95, 2)} ms`, s.p95 <= FRAME_BUDGET_MS ? "ok" : "warn");
    this.set("max", `${formatFixed(s.max, 1)} ms`);
    this.set("budget", `${formatFixed((s.avg / FRAME_BUDGET_MS) * 100, 0)} %`);
    this.set("over", `${s.overBudget} / ${s.frames}`, s.overBudget === 0 ? "ok" : "warn");
    this.set("dropped", formatCount(perf.droppedFrames()));
    this.set("inview", formatCount(this.chart.pointsInView));
    this.set("vertices", formatCount(this.chart.vertices));
    this.set("buffer", `${formatCount(pts.length)} / ${formatCount(pts.capacity)}`);
    this.set("buffermem", `${formatMB(pts.byteLength)} fixed`);
    this.set("msgs", status ? formatCount(status.msgsPerSec) : "—");
    this.set("trades", status ? formatCount(status.tradesPerSec) : "—");
    this.set("kb", status ? `${formatFixed(status.kbPerSec, 1)} KB/s` : "—");
    this.set("worker", status ? `${formatFixed(status.workerMsPerSec, 1)} ms/s` : "—");
    this.set("ingest", `${formatFixed(this.ingestPerSec, 1)} ms/s`);
    const memory = (performance as Performance & { memory?: PerfMemory }).memory;
    this.set("heap", memory ? formatMB(memory.usedJSHeapSize) : "n/a in this browser");
    const parts: string[] = [];
    for (const [name, ms] of this.loop.taskMs) parts.push(`${name} ${formatFixed(ms, 2)}`);
    this.set("tasks", parts.join(" · "));
  }

  private drawSpark(): void {
    const w = Math.max(1, this.sparkW);
    const h = Math.max(1, this.sparkH);
    const dpr = window.devicePixelRatio || 1;
    this.spark.resize(w, h, dpr);
    const ctx = this.spark.begin();
    const perf = this.loop.perf;
    const n = Math.min(BARS, perf.frames);
    const bw = w / BARS;
    const yOf = (ms: number) => h - (Math.min(ms, SCALE_MS) / SCALE_MS) * h;
    const over = pattern(ctx, "forward", COLORS.down, dpr, 4);
    for (let k = 0; k < n; k++) {
      const ms = perf.drawAt(k);
      const x = w - (k + 1) * bw;
      const y = yOf(ms);
      // Over budget: different fill texture, not only a different colour.
      ctx.fillStyle = ms > FRAME_BUDGET_MS ? over : COLORS.line;
      ctx.fillRect(x, y, Math.max(1, bw - 0.5), h - y);
    }
    const by = crisp(yOf(FRAME_BUDGET_MS), dpr);
    ctx.strokeStyle = COLORS.budget;
    ctx.lineWidth = 1 / dpr;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(0, by);
    ctx.lineTo(w, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = FONT;
    ctx.fillStyle = COLORS.budget;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("16.7 ms budget", w - 2, by - 2);
  }
}
