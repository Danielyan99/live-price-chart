/**
 * Parser for the Coinbase Exchange public WebSocket feed
 * (wss://ws-feed.exchange.coinbase.com). Turns raw JSON frames into small,
 * typed events. Prices and sizes arrive as decimal strings; they are parsed
 * once here.
 */

export const COINBASE_WS_URL = "wss://ws-feed.exchange.coinbase.com";
export const COINBASE_REST_URL = "https://api.exchange.coinbase.com";
export const PRODUCT_ID = "BTC-USD";
export const CHANNELS = ["ticker", "matches", "level2_batch", "heartbeat"] as const;

export function subscribeMessage(): string {
  return JSON.stringify({ type: "subscribe", product_ids: [PRODUCT_ID], channels: CHANNELS });
}

export interface TradeEvent {
  kind: "trade";
  id: number;
  /** Exchange time in ms since epoch (fractional ms kept). */
  time: number;
  price: number;
  size: number;
  /** True when the taker (aggressor) bought. */
  takerBuy: boolean;
}

export type FeedEvent =
  | TradeEvent
  | {
      kind: "ticker";
      time: number;
      price: number;
      open24h: number;
      high24h: number;
      low24h: number;
      volume24h: number;
    }
  | { kind: "book-snapshot"; bids: Array<[number, number]>; asks: Array<[number, number]> }
  | { kind: "book-update"; changes: Array<{ bid: boolean; price: number; size: number }> }
  /** Sent every second; `lastTradeId` is the newest trade at that time. */
  | { kind: "heartbeat"; time: number; lastTradeId: number }
  | { kind: "subscribed"; channels: string[] }
  | { kind: "error"; message: string };

/**
 * ISO-8601 UTC time with up to microseconds ("2026-10-15T16:00:21.306925Z")
 * to ms since epoch. `Date.parse` only keeps 3 fraction digits, so the rest
 * is added back as fractional ms to keep trades in the same ms ordered.
 */
export function parseIsoTime(iso: string): number {
  const dot = iso.indexOf(".");
  if (dot === -1) return Date.parse(iso);
  const end = iso.endsWith("Z") ? iso.length - 1 : iso.length;
  const whole = Date.parse(iso.slice(0, dot) + "Z");
  const fraction = Number("0" + iso.slice(dot, end));
  return whole + fraction * 1000;
}

/**
 * The `side` field of a match (and of REST trades) is the MAKER side: the
 * resting order. The taker did the opposite, so a "sell" maker means the
 * taker bought (an up-tick). Checked against the ticker channel, whose
 * `side` is the taker side.
 */
export function takerBoughtFromMakerSide(makerSide: string): boolean {
  return makerSide === "sell";
}

function levels(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<[string, string]>).map(([price, size]) => [Number(price), Number(size)]);
}

/** Parses one WebSocket frame. Returns null for frames this app does not use. */
export function parseCoinbaseMessage(raw: string): FeedEvent | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { kind: "error", message: "Malformed JSON from feed" };
  }
  switch (m.type) {
    case "match":
    case "last_match":
      return {
        kind: "trade",
        id: Number(m.trade_id),
        time: parseIsoTime(String(m.time)),
        price: Number(m.price),
        size: Number(m.size),
        takerBuy: takerBoughtFromMakerSide(String(m.side)),
      };
    case "ticker":
      return {
        kind: "ticker",
        time: parseIsoTime(String(m.time)),
        price: Number(m.price),
        open24h: Number(m.open_24h),
        high24h: Number(m.high_24h),
        low24h: Number(m.low_24h),
        volume24h: Number(m.volume_24h),
      };
    case "snapshot":
      return { kind: "book-snapshot", bids: levels(m.bids), asks: levels(m.asks) };
    case "l2update": {
      const raw = Array.isArray(m.changes) ? (m.changes as Array<[string, string, string]>) : [];
      return {
        kind: "book-update",
        changes: raw.map(([side, price, size]) => ({
          bid: side === "buy",
          price: Number(price),
          size: Number(size),
        })),
      };
    }
    case "heartbeat":
      return {
        kind: "heartbeat",
        time: parseIsoTime(String(m.time)),
        lastTradeId: Number(m.last_trade_id),
      };
    case "subscriptions": {
      const channels = Array.isArray(m.channels)
        ? (m.channels as Array<{ name?: unknown }>).map((c) => String(c.name))
        : [];
      return { kind: "subscribed", channels };
    }
    case "error":
      return {
        kind: "error",
        message: [m.message, m.reason].filter((s) => typeof s === "string" && s).join(": "),
      };
    default:
      return null;
  }
}

/** True when the subscription confirmation includes the trades channel. */
export function hasTradeChannel(channels: readonly string[]): boolean {
  return channels.includes("matches");
}

/** True when the subscription confirmation includes an order-book channel. */
export function hasBookChannel(channels: readonly string[]): boolean {
  return channels.some((c) => c.startsWith("level2"));
}

/** One trade from GET /products/{id}/trades (newest first, paged with `after`). */
export interface RestTrade {
  trade_id: number;
  side: string;
  size: string;
  price: string;
  time: string;
}

export function parseRestTrade(t: RestTrade): TradeEvent {
  return {
    kind: "trade",
    id: t.trade_id,
    time: parseIsoTime(t.time),
    price: Number(t.price),
    size: Number(t.size),
    takerBuy: takerBoughtFromMakerSide(t.side),
  };
}
