import type {
  ActiveSource,
  BackfillState,
  FromWorker,
  SocketState,
  SourcePref,
  ToWorker,
} from "../feed/protocol.ts";
import { freshness } from "../lib/staleness.ts";
import { DepthChart, type DepthSource } from "./depthChart.ts";
import { FrameLoop } from "./frameLoop.ts";
import { Observable } from "./observable.ts";
import { PerfPanel } from "./perfPanel.ts";
import { summarizeRun, type FrameRunSummary } from "./perfStats.ts";
import { PriceChart, type ChartClock } from "./priceChart.ts";
import { Replay } from "./replay.ts";
import { StatusBar } from "./statusBar.ts";
import { MarketStore } from "./store.ts";
import { TradesTable } from "./tradesTable.ts";

/** Feed state that React shows. Changes a few times per session, not per tick. */
export interface FeedUi {
  pref: SourcePref;
  source: ActiveSource;
  socket: SocketState;
  bookSource: "live" | "sim" | "none";
  stress: boolean;
  backfill: BackfillState;
  backfillCount: number;
  lastError: string | null;
  reconnects: number;
  retryAt: number | null;
}

export interface Settings {
  /** Data older than this is shown as stale. */
  staleMs: number;
  /** Depth chart half-range in percent of the mid price. */
  depthRangePct: number;
}

export const STALE_CHOICES = [500, 1000, 2000, 5000];
export const DEPTH_RANGES = [0.1, 0.5, 2];

export interface MeasureReport extends FrameRunSummary {
  seconds: number;
  /** Raw points in the chart view (average over the run). */
  pointsInView: number;
  verticesDrawn: number;
  bufferPoints: number;
  msgsPerSec: number;
  tradesPerSec: number;
  source: ActiveSource;
  stress: boolean;
  replay: boolean;
  viewport: string;
  at: string;
}

export interface MeasureUi {
  running: boolean;
  report: MeasureReport | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Owns the feed worker, the market store, the frame loop and the canvas
 * views. Created once, outside React, so StrictMode double mounts and
 * re-renders never restart the feed. React components only mount DOM nodes
 * into it and call its commands.
 */
export class Engine {
  readonly store = new MarketStore();
  readonly loop = new FrameLoop();
  readonly feed = new Observable<FeedUi>({
    pref: "auto",
    source: "none",
    socket: "connecting",
    bookSource: "none",
    stress: false,
    backfill: "idle",
    backfillCount: 0,
    lastError: null,
    reconnects: 0,
    retryAt: null,
  });
  readonly settings = new Observable<Settings>({ staleMs: 2000, depthRangePct: 0.5 });
  readonly measurement = new Observable<MeasureUi>({ running: false, report: null });

  /** Exchange time now: local time plus the offset measured from message times. */
  liveNow(): number {
    return Date.now() + (this.store.status?.clockOffset ?? 0);
  }

  readonly replay = new Replay(this.store.points, () => this.liveNow());

  /**
   * The one clock every view reads. Live: "now" is the exchange time and
   * the data is known up to the newest message. Replay: "now" is the
   * cursor, and nothing after it exists for the views.
   */
  readonly clock: ChartClock = {
    head: () => (this.replay.active ? this.replay.cursor : this.liveNow()),
    knownUntil: () => {
      if (this.replay.active) return this.replay.cursor;
      const s = this.store.status;
      return s ? s.dataAsOf + s.clockOffset : -Infinity;
    },
    limit: () => (this.replay.active ? this.replay.cursor : Infinity),
  };

  /** True when the newest delivered data is older than the stale threshold. */
  isStale(): boolean {
    const s = this.store.status;
    return freshness(Date.now(), s?.dataAsOf ?? null, this.settings.get().staleMs).kind === "stale";
  }

  readonly depthSource: DepthSource = {
    depth: () => (this.replay.active ? this.store.depthAt(this.replay.cursor) : this.store.depth),
    recorded: () => this.replay.active,
    recordedSince: () => this.store.depthHistory[0]?.time ?? null,
    stale: () => !this.replay.active && this.isStale(),
  };

  readonly chart = new PriceChart(this.store, this.clock);
  readonly trades = new TradesTable(this.store, this.clock);
  readonly depthChart = new DepthChart(this.depthSource);
  readonly statusBar = new StatusBar(this.store, this.clock, this.depthSource, {
    staleMs: () => this.settings.get().staleMs,
    replay: () => {
      if (!this.replay.active) return null;
      const ui = this.replay.ui.get();
      return {
        cursor: this.replay.cursor,
        behindMs: this.liveNow() - this.replay.cursor,
        playing: ui.playing,
        speed: ui.speed,
      };
    },
  });
  readonly perfPanel = new PerfPanel(this.loop, this.store, this.chart);

  private readonly worker: Worker;

  constructor() {
    this.worker = new Worker(new URL("../feed/feed.worker.ts", import.meta.url), {
      type: "module",
      name: "feed",
    });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onBatch(ev.data);
    // Order matters: replay moves the cursor first, then everything draws.
    this.loop.add(this.replay);
    this.loop.add(this.statusBar);
    this.loop.add(this.chart);
    this.loop.add(this.depthChart);
    this.loop.add(this.trades);
    this.loop.add(this.perfPanel);
    this.loop.start();
  }

  private onBatch(msg: FromWorker): void {
    // Data only lands in the store; drawing happens in the next frame.
    this.store.ingest(msg);
    // New data replaced the recording (prefill): a running replay is void.
    if (msg.reset && this.replay.active) this.replay.exit();
    const s = msg.status;
    this.feed.set({
      pref: s.pref,
      source: s.source,
      socket: s.socket,
      bookSource: s.bookSource,
      stress: s.stress,
      backfill: s.backfill,
      backfillCount: s.backfillCount,
      lastError: s.lastError,
      reconnects: s.reconnects,
      retryAt: s.retryAt,
    });
  }

  private send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  setSource(pref: SourcePref): void {
    this.send({ type: "source", pref });
  }

  setStress(on: boolean): void {
    this.send({ type: "stress", on });
  }

  stall(ms: number): void {
    this.send({ type: "stall", ms });
  }

  dropSocket(): void {
    this.send({ type: "drop-socket" });
  }

  setDepthRange(pct: number): void {
    this.settings.set({ depthRangePct: pct });
    this.send({ type: "depth-range", pct });
  }

  setStaleMs(ms: number): void {
    this.settings.set({ staleMs: ms });
  }

  prefill(count: number, spanMs: number): void {
    this.send({ type: "prefill", count, spanMs });
  }

  enterReplay(): void {
    this.replay.enter();
    this.chart.goLive(); // follow the cursor
  }

  exitReplay(): void {
    this.replay.exit();
    this.chart.goLive();
  }

  /**
   * Records every frame for `seconds` and summarises it: FPS, draw time
   * percentiles, frames over budget, plus what was on screen. The README
   * numbers come from this function (scripts/measure.mjs calls it).
   */
  async measure(seconds = 10): Promise<MeasureReport> {
    this.measurement.set({ running: true });
    const inView: number[] = [];
    const vertices: number[] = [];
    const msgs: number[] = [];
    const trades: number[] = [];
    this.loop.startMeasure();
    const t0 = performance.now();
    for (let i = 0; i < seconds; i++) {
      await sleep(1000);
      inView.push(this.chart.pointsInView);
      vertices.push(this.chart.vertices);
      msgs.push(this.store.status?.msgsPerSec ?? 0);
      trades.push(this.store.status?.tradesPerSec ?? 0);
    }
    const run = this.loop.stopMeasure();
    const elapsed = performance.now() - t0;
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const report: MeasureReport = {
      ...summarizeRun(run.draw, run.interval, elapsed),
      seconds,
      pointsInView: Math.round(mean(inView)),
      verticesDrawn: Math.round(mean(vertices)),
      bufferPoints: this.store.points.length,
      msgsPerSec: Math.round(mean(msgs)),
      tradesPerSec: Math.round(mean(trades)),
      source: this.store.status?.source ?? "none",
      stress: this.store.status?.stress ?? false,
      replay: this.replay.active,
      viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
      at: new Date().toISOString(),
    };
    this.measurement.set({ running: false, report });
    return report;
  }
}

export const engine = new Engine();

declare global {
  interface Window {
    /** Handle for debugging and for the measurement script (scripts/measure.mjs). */
    __lpc?: Engine;
  }
}
window.__lpc = engine;
