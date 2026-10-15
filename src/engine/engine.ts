import type {
  ActiveSource,
  BackfillState,
  FromWorker,
  SocketState,
  SourcePref,
  ToWorker,
} from "../feed/protocol.ts";
import { FrameLoop } from "./frameLoop.ts";
import { Observable } from "./observable.ts";
import { PerfPanel } from "./perfPanel.ts";
import { PriceChart, type ChartClock } from "./priceChart.ts";
import { MarketStore } from "./store.ts";

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
  /** Local time until which a requested stall lasts (for the UI note). */
  stallUntil = 0;

  /** Live clock: exchange time is local time plus the measured offset. */
  readonly clock: ChartClock = {
    head: () => Date.now() + (this.store.status?.clockOffset ?? 0),
    knownUntil: () => {
      const s = this.store.status;
      return s ? s.dataAsOf + s.clockOffset : -Infinity;
    },
    limit: () => Infinity,
  };

  readonly chart = new PriceChart(this.store, this.clock);
  readonly perfPanel = new PerfPanel(this.loop, this.store, this.chart);

  private readonly worker: Worker;

  constructor() {
    this.worker = new Worker(new URL("../feed/feed.worker.ts", import.meta.url), {
      type: "module",
      name: "feed",
    });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onBatch(ev.data);
    this.loop.add(this.chart);
    this.loop.add(this.perfPanel);
    this.loop.start();
  }

  private onBatch(msg: FromWorker): void {
    // Data only lands in the store; drawing happens in the next frame.
    this.store.ingest(msg);
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
    this.stallUntil = Date.now() + ms;
    this.send({ type: "stall", ms });
  }

  dropSocket(): void {
    this.send({ type: "drop-socket" });
  }

  setDepthRange(pct: number): void {
    this.send({ type: "depth-range", pct });
  }

  prefill(count: number, spanMs: number): void {
    this.send({ type: "prefill", count, spanMs });
  }
}

export const engine = new Engine();

declare global {
  interface Window {
    /** Handle for debugging and for the measurement script in the README. */
    __lpc?: Engine;
  }
}
window.__lpc = engine;
