/**
 * Feed worker. Owns the WebSocket, the order book and the simulator, so JSON
 * parsing and book maintenance never touch the UI thread. Everything that
 * happens is collected and posted to the main thread as one batch every
 * BATCH_MS, with typed arrays transferred (not copied).
 */
import { FLAG_BUY, FLAG_SIM } from "../lib/ringBuffer.ts";
import { OrderBook, depthCurve } from "../lib/orderBook.ts";
import {
  COINBASE_REST_URL,
  COINBASE_WS_URL,
  PRODUCT_ID,
  hasBookChannel,
  parseCoinbaseMessage,
  parseRestTrade,
  subscribeMessage,
  type FeedEvent,
  type RestTrade,
  type TradeEvent,
} from "./coinbase.ts";
import type {
  ActiveSource,
  BackfillState,
  BatchMessage,
  DepthSnapshot,
  FeedStatus,
  SocketState,
  SourcePref,
  TickerStats,
  ToWorker,
} from "./protocol.ts";
import { DEFAULT_SIM_CONFIG, MarketSimulator } from "./simulator.ts";

const BATCH_MS = 50;
const CONNECT_TIMEOUT_MS = 8000;
/**
 * An open socket that sends nothing for this long is treated as dead. The
 * real feed often pauses 1-3 s (heartbeats included), so this is set well
 * above that; the stale badge shows the shorter pauses.
 */
const SILENT_SOCKET_MS = 8000;
const FIRST_RETRY_MS = 2000;
const MAX_RETRY_MS = 30_000;
const BACKFILL_PAGES = 10;
const BACKFILL_TIMEOUT_MS = 10_000;
const DEPTH_POINTS = 200;
const STRESS_SPEED = 10;
/** Used only when the simulator starts before any live price is known. */
const DEFAULT_START_PRICE = 80_000;

/** The parts of the worker global scope this file uses (the DOM lib types `self` as Window). */
interface WorkerScope {
  postMessage(message: BatchMessage, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FeedController {
  private pref: SourcePref = "auto";
  private stress = false;
  private stallUntil = 0;
  private depthRangePct = 0.5;

  private source: ActiveSource = "none";
  /** Auto mode: live failed, so the simulator stands in until live is back. */
  private fallback = false;

  // Live feed state.
  private ws: WebSocket | null = null;
  private socket: SocketState = "off";
  private subscribed = false;
  private liveHasBook = true;
  private liveBookReady = false;
  private readonly liveBook = new OrderBook();
  private lastSocketMsgAt = 0;
  private lastTradeId = 0;
  private lastLivePrice = NaN;
  private ticker: TickerStats | null = null;
  private retryDelay = FIRST_RETRY_MS;
  private retryAt: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnects = 0;
  private lastError: string | null = null;

  // History backfill. Live trades are shown at once and also recorded while
  // history loads; then the chart is rebuilt as history + those live trades.
  private backfill: BackfillState = "idle";
  private backfillCount = 0;
  private recordLive = false;
  private liveDuringHistory: TradeEvent[] = [];
  private simEmitted = false;

  // Simulated feed (also used for the book when live has no book channel).
  private sim: MarketSimulator | null = null;

  // Exchange clock estimate: max of (message time - receive time) per second.
  private clockOffset = 0;
  private hasClock = false;
  private secondMax = -Infinity;
  private recentMax: number[] = [];

  // Output for the next batch.
  private pending: number[] = [];
  private reset = false;
  private bookDirty = true;
  private dataAsOf = 0;
  private lastEmittedTime = -Infinity;

  // Per-second counters and the rates derived from them.
  private msgs = 0;
  private trades = 0;
  private bytes = 0;
  private busyMs = 0;
  private rates = { msgs: 0, trades: 0, kb: 0, busy: 0 };

  start(): void {
    setInterval(() => this.flush(), BATCH_MS);
    setInterval(() => this.everySecond(), 1000);
    this.connect();
    void this.loadHistory();
  }

  handle(msg: ToWorker): void {
    switch (msg.type) {
      case "source":
        this.pref = msg.pref;
        if (msg.pref === "sim") {
          this.closeSocket();
        } else {
          this.fallback = msg.pref === "auto" && this.socket !== "open";
          this.connect();
        }
        this.updateSource();
        break;
      case "stress":
        this.stress = msg.on;
        this.updateSource();
        break;
      case "stall":
        this.stallUntil = Date.now() + msg.ms;
        break;
      case "drop-socket":
        this.dropSocket("Socket closed on purpose (fallback test)");
        break;
      case "depth-range":
        this.depthRangePct = msg.pct;
        this.bookDirty = true;
        break;
      case "prefill":
        this.prefill(msg.count, msg.spanMs);
        break;
    }
  }

  private exchangeNow(): number {
    return Date.now() + this.clockOffset;
  }

  // ---- Source selection -------------------------------------------------

  /** Trades can flow once subscribed; the book follows when its snapshot arrives. */
  private liveReady(): boolean {
    return this.socket === "open" && this.subscribed;
  }

  private pickSource(): ActiveSource {
    if (this.stress || this.pref === "sim") return "sim";
    if (this.liveReady()) return "live";
    if (this.pref === "auto" && this.fallback) return "sim";
    return "none";
  }

  private updateSource(): void {
    const next = this.pickSource();
    if (next === "sim" && (this.source !== "sim" || !this.sim)) this.startSim();
    if (this.sim) this.sim.speed = this.stress ? STRESS_SPEED : 1;
    if (next !== this.source) {
      this.source = next;
      this.bookDirty = true;
    }
  }

  private currentPrice(): number {
    if (!Number.isNaN(this.lastLivePrice)) return this.lastLivePrice;
    if (!Number.isNaN(this.liveBook.mid)) return this.liveBook.mid;
    return this.sim?.midPrice ?? DEFAULT_START_PRICE;
  }

  /** Starts the simulator from the current price, so the line stays continuous. */
  private startSim(): void {
    this.sim = new MarketSimulator(Date.now() >>> 0, this.currentPrice(), this.exchangeNow());
  }

  // ---- Live socket ------------------------------------------------------

  private connect(): void {
    if (this.ws || this.pref === "sim") return;
    clearTimeout(this.retryTimer);
    this.retryAt = null;
    this.socket = "connecting";
    this.subscribed = false;
    this.liveBookReady = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(COINBASE_WS_URL);
    } catch (err) {
      this.onSocketDown(`Cannot open socket: ${String(err)}`);
      return;
    }
    this.ws = ws;
    this.connectTimer = setTimeout(() => {
      if (!this.liveReady()) this.dropSocket("Connect timeout");
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      this.socket = "open";
      this.lastSocketMsgAt = Date.now();
      ws.send(subscribeMessage());
    };
    ws.onmessage = (ev: MessageEvent<string>) => this.onSocketMessage(ev.data);
    ws.onclose = (ev) => {
      if (this.ws === ws) this.onSocketDown(`Socket closed (code ${ev.code})`);
    };
  }

  /** Closes the socket and does not reconnect (user picked the simulator). */
  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectTimer);
    this.retryAt = null;
    this.socket = "off";
    this.subscribed = false;
    this.liveBookReady = false;
    ws?.close();
  }

  private dropSocket(reason: string): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.close();
    this.onSocketDown(reason);
  }

  private onSocketDown(reason: string): void {
    this.ws = null;
    clearTimeout(this.connectTimer);
    this.socket = "closed";
    this.subscribed = false;
    this.liveBookReady = false;
    this.lastError = reason;
    if (this.pref === "auto") this.fallback = true;
    this.updateSource();
    if (this.pref === "sim") return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(MAX_RETRY_MS, delay * 2);
    this.retryAt = Date.now() + delay;
    this.retryTimer = setTimeout(() => {
      this.reconnects++;
      this.connect();
    }, delay);
  }

  private onSocketMessage(data: string): void {
    const t0 = performance.now();
    const now = Date.now();
    this.lastSocketMsgAt = now;
    this.msgs++;
    this.bytes += data.length;
    const event = parseCoinbaseMessage(data);
    if (event) this.onLiveEvent(event, now);
    if (this.source === "live") this.dataAsOf = now;
    this.busyMs += performance.now() - t0;
  }

  private onLiveEvent(e: FeedEvent, now: number): void {
    switch (e.kind) {
      case "subscribed":
        this.subscribed = true;
        this.liveHasBook = hasBookChannel(e.channels);
        this.liveReadyCheck();
        break;
      case "book-snapshot":
        this.liveBook.bids.load(e.bids);
        this.liveBook.asks.load(e.asks);
        this.liveBookReady = true;
        this.bookDirty = true;
        this.liveReadyCheck();
        break;
      case "book-update":
        for (const c of e.changes)
          (c.bid ? this.liveBook.bids : this.liveBook.asks).set(c.price, c.size);
        this.bookDirty = true;
        break;
      case "ticker":
        this.observeClock(e.time, now);
        this.ticker = {
          open24h: e.open24h,
          high24h: e.high24h,
          low24h: e.low24h,
          volume24h: e.volume24h,
        };
        break;
      case "heartbeat":
        this.observeClock(e.time, now);
        break;
      case "trade":
        this.observeClock(e.time, now);
        // last_match repeats a trade we may already have after a reconnect.
        if (e.id <= this.lastTradeId) return;
        this.lastTradeId = e.id;
        this.lastLivePrice = e.price;
        if (this.source === "live") {
          this.emitTrade(e, false);
          if (this.recordLive) this.liveDuringHistory.push(e);
        }
        break;
      case "error":
        this.lastError = e.message;
        break;
    }
  }

  private liveReadyCheck(): void {
    if (!this.liveReady()) return;
    clearTimeout(this.connectTimer);
    this.retryDelay = FIRST_RETRY_MS;
    this.fallback = false;
    this.lastError = null;
    this.updateSource();
  }

  private observeClock(exchangeTime: number, receivedAt: number): void {
    const sample = exchangeTime - receivedAt;
    if (sample > this.secondMax) this.secondMax = sample;
    // Raise at once (a faster message is better evidence); lower only via
    // the 10 s window in everySecond(). The first frame (last_match) can be
    // an old trade, so the first sample is not trusted on its own.
    if (!this.hasClock || sample > this.clockOffset) {
      this.hasClock = true;
      this.clockOffset = sample;
    }
  }

  // ---- History ----------------------------------------------------------

  /** Loads ~10k recent real trades over REST so the chart starts full. */
  private async loadHistory(): Promise<void> {
    if (this.pref === "sim" || this.stress) {
      this.backfill = "skipped";
      return;
    }
    this.backfill = "loading";
    this.recordLive = true;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), BACKFILL_TIMEOUT_MS);
    try {
      const trades: TradeEvent[] = [];
      let after = "";
      for (let page = 0; page < BACKFILL_PAGES; page++) {
        const url = `${COINBASE_REST_URL}/products/${PRODUCT_ID}/trades?limit=1000${after ? `&after=${after}` : ""}`;
        const res = await fetch(url, { signal: abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = (await res.json()) as RestTrade[];
        for (const row of rows) trades.push(parseRestTrade(row));
        after = res.headers.get("cb-after") ?? "";
        if (!after || rows.length === 0) break;
        await sleep(120); // stay well under the public rate limit
      }
      // Simulated points already in the chart cannot be mixed with real
      // history (and older trades cannot go in front of them): skip.
      if (this.simEmitted) {
        this.backfill = "skipped";
        return;
      }
      trades.sort((a, b) => a.id - b.id);
      const live = this.liveDuringHistory;
      const firstLive = live.length > 0 ? live[0].id : Infinity;
      // One reset batch: history first, then the live trades shown so far.
      this.pending.length = 0;
      this.reset = true;
      this.lastEmittedTime = -Infinity;
      let added = 0;
      for (const t of trades) {
        if (t.id >= firstLive) break;
        this.emitTrade(t, false, false);
        added++;
        if (t.id > this.lastTradeId) this.lastTradeId = t.id;
        if (live.length === 0) this.lastLivePrice = t.price;
      }
      for (const t of live) this.emitTrade(t, false, false);
      this.backfill = "done";
      this.backfillCount = added;
    } catch (err) {
      this.backfill = "failed";
      this.lastError = `History: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      clearTimeout(timer);
      this.recordLive = false;
      this.liveDuringHistory = [];
    }
  }

  /** Replaces the chart data with simulated history and turns stress on. */
  private prefill(count: number, spanMs: number): void {
    const end = this.exchangeNow();
    const start = end - spanMs;
    const sim = new MarketSimulator(Date.now() >>> 0, this.currentPrice(), start, {
      ...DEFAULT_SIM_CONFIG,
      tradesPerSec: count / (spanMs / 1000),
      bookUpdatesPerSec: 1,
    });
    this.pending.length = 0;
    this.reset = true;
    this.lastEmittedTime = -Infinity;
    // Advance in 1 s steps; the simulator only catches up 5 s per call.
    for (let t = start + 1000; t < end + 1000; t += 1000) {
      sim.advance(Math.min(t, end), (e) => {
        if (e.kind === "trade") this.emitTrade(e, true, false);
      });
    }
    sim.config.tradesPerSec = DEFAULT_SIM_CONFIG.tradesPerSec;
    sim.config.bookUpdatesPerSec = DEFAULT_SIM_CONFIG.bookUpdatesPerSec;
    // Keep this simulator running (setting source first stops updateSource
    // from starting a fresh one), so the line continues from the history.
    this.sim = sim;
    this.source = "sim";
    this.stress = true;
    this.updateSource();
    this.bookDirty = true;
  }

  // ---- Output -----------------------------------------------------------

  private emitTrade(e: TradeEvent, simulated: boolean, count = true): void {
    // Time must never go backwards in the chart buffer. Across a source
    // switch the clocks can disagree by a few ms; clamp instead of reorder.
    const time = e.time < this.lastEmittedTime ? this.lastEmittedTime : e.time;
    this.lastEmittedTime = time;
    const flags = (e.takerBuy ? FLAG_BUY : 0) | (simulated ? FLAG_SIM : 0);
    this.pending.push(time, e.price, e.size, flags);
    if (simulated) this.simEmitted = true;
    if (count) this.trades++;
  }

  private runSim(): void {
    const sim = this.sim;
    if (!sim) return;
    const t0 = performance.now();
    if (this.source === "sim") {
      sim.advance(this.exchangeNow(), (e) => {
        this.msgs++;
        if (e.kind === "trade") this.emitTrade(e, true);
        else this.bookDirty = true;
      });
      this.dataAsOf = Date.now();
    } else if (this.source === "live" && !this.liveHasBook) {
      // Live trades, but no live book: keep a simulated book around the live price.
      sim.anchor(this.currentPrice());
      sim.advance(this.exchangeNow(), (e) => {
        if (e.kind === "book") this.bookDirty = true;
      });
    }
    this.busyMs += performance.now() - t0;
  }

  private activeBook(): { book: OrderBook; source: "live" | "sim" } | null {
    if (this.source === "sim" && this.sim) return { book: this.sim.book, source: "sim" };
    if (this.source === "live") {
      if (this.liveBookReady) return { book: this.liveBook, source: "live" };
      if (!this.liveHasBook && this.sim) return { book: this.sim.book, source: "sim" };
    }
    return null;
  }

  private buildDepth(): DepthSnapshot | null {
    const active = this.activeBook();
    if (!active || active.book.crossed) return null;
    const { book, source } = active;
    const mid = book.mid;
    if (Number.isNaN(mid)) return null;
    const half = (mid * this.depthRangePct) / 100;
    const bids = depthCurve(book.bids, mid - half, DEPTH_POINTS);
    const asks = depthCurve(book.asks, mid + half, DEPTH_POINTS);
    return {
      time: this.exchangeNow(),
      source,
      bestBid: book.bestBid,
      bestAsk: book.bestAsk,
      rangePct: this.depthRangePct,
      bidPrices: bids.prices,
      bidCum: bids.cumulative,
      askPrices: asks.prices,
      askCum: asks.cumulative,
    };
  }

  private flush(): void {
    if (this.source === "live" && !this.liveHasBook && !this.sim) this.startSim();
    this.runSim();
    // A simulated stall: keep collecting, deliver nothing.
    if (Date.now() < this.stallUntil) return;

    const depth = this.bookDirty ? this.buildDepth() : null;
    this.bookDirty = false;
    const points = new Float64Array(this.pending);
    this.pending.length = 0;
    const msg: BatchMessage = {
      type: "batch",
      reset: this.reset,
      points,
      depth,
      status: this.status(),
    };
    this.reset = false;
    const transfer: Transferable[] = [points.buffer];
    if (depth) {
      transfer.push(
        depth.bidPrices.buffer,
        depth.bidCum.buffer,
        depth.askPrices.buffer,
        depth.askCum.buffer,
      );
    }
    scope.postMessage(msg, transfer);
  }

  private everySecond(): void {
    this.rates = {
      msgs: this.msgs,
      trades: this.trades,
      kb: this.bytes / 1024,
      busy: this.busyMs,
    };
    this.msgs = 0;
    this.trades = 0;
    this.bytes = 0;
    this.busyMs = 0;

    // Exchange clock: the largest (message time - receive time) seen in the
    // last 10 s is the exchange clock minus the fastest delivery.
    if (this.secondMax > -Infinity) {
      this.recentMax.push(this.secondMax);
      if (this.recentMax.length > 10) this.recentMax.shift();
      this.clockOffset = Math.max(...this.recentMax);
      this.secondMax = -Infinity;
    }

    if (this.socket === "open" && Date.now() - this.lastSocketMsgAt > SILENT_SOCKET_MS) {
      this.dropSocket(`No data for ${SILENT_SOCKET_MS / 1000} s`);
    }
  }

  private status(): FeedStatus {
    return {
      pref: this.pref,
      source: this.source,
      socket: this.socket,
      bookSource: this.activeBook()?.source ?? "none",
      stress: this.stress,
      msgsPerSec: this.rates.msgs,
      tradesPerSec: this.rates.trades,
      kbPerSec: this.rates.kb,
      workerMsPerSec: this.rates.busy,
      dataAsOf: this.dataAsOf,
      clockOffset: this.clockOffset,
      reconnects: this.reconnects,
      retryAt: this.retryAt,
      lastError: this.lastError,
      backfill: this.backfill,
      backfillCount: this.backfillCount,
      ticker: this.ticker,
    };
  }
}

const controller = new FeedController();
scope.onmessage = (ev: MessageEvent<ToWorker>) => controller.handle(ev.data);
controller.start();
