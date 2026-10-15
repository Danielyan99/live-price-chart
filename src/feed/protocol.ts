/** Messages between the main thread and the feed worker. */

/** What the user picked. "auto" = live, falling back to simulated when live fails. */
export type SourcePref = "auto" | "live" | "sim";
/** Where points come from right now. */
export type ActiveSource = "live" | "sim" | "none";
export type SocketState = "off" | "connecting" | "open" | "closed";

/** Numbers per point in a batch: time, price, size, flags. */
export const POINT_STRIDE = 4;

export interface DepthSnapshot {
  /** Exchange-clock time when the snapshot was taken. */
  time: number;
  source: "live" | "sim";
  bestBid: number;
  bestAsk: number;
  /** Half-width of the shown range, in percent of the mid price. */
  rangePct: number;
  bidPrices: Float64Array;
  bidCum: Float64Array;
  askPrices: Float64Array;
  askCum: Float64Array;
}

export interface TickerStats {
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

export type BackfillState = "idle" | "loading" | "done" | "failed" | "skipped";

export interface FeedStatus {
  pref: SourcePref;
  source: ActiveSource;
  socket: SocketState;
  bookSource: "live" | "sim" | "none";
  stress: boolean;
  /** Feed messages per second (socket frames, or simulated events). */
  msgsPerSec: number;
  /** Trades added to the chart per second. */
  tradesPerSec: number;
  kbPerSec: number;
  /** Time the worker spent handling messages, per second of wall time. */
  workerMsPerSec: number;
  /** Local time (Date.now) when the newest message in this batch arrived. */
  dataAsOf: number;
  /** Add to Date.now() to get exchange time. Estimated from message times. */
  clockOffset: number;
  reconnects: number;
  /** Local time of the next reconnect attempt, if one is scheduled. */
  retryAt: number | null;
  lastError: string | null;
  backfill: BackfillState;
  backfillCount: number;
  ticker: TickerStats | null;
}

export type ToWorker =
  | { type: "source"; pref: SourcePref }
  | { type: "stress"; on: boolean }
  /** Hold back all output for `ms`, like a network stall. */
  | { type: "stall"; ms: number }
  /** Close the socket on purpose, to test the fallback. */
  | { type: "drop-socket" }
  | { type: "depth-range"; pct: number }
  /** Replace the chart data with `count` simulated points over `spanMs`, then stress. */
  | { type: "prefill"; count: number; spanMs: number };

export interface BatchMessage {
  type: "batch";
  /** Clear stored points before adding these. */
  reset: boolean;
  /** POINT_STRIDE numbers per point, oldest first. */
  points: Float64Array;
  /** True when the book changed since the last batch; then `depth` replaces the old one. */
  depthChanged: boolean;
  /** New depth, or null when no trustworthy book is available (yet). */
  depth: DepthSnapshot | null;
  status: FeedStatus;
}

export type FromWorker = BatchMessage;
