import { describe, expect, it } from "vitest";
import { hasBookChannel, parseCoinbaseMessage, parseIsoTime, parseRestTrade } from "./coinbase.ts";

// Frames below are trimmed copies of real messages from the feed.
describe("parseIsoTime", () => {
  it("keeps microseconds as fractional ms", () => {
    const base = Date.UTC(2026, 9, 15, 16, 0, 21);
    expect(parseIsoTime("2026-10-15T16:00:21.306925Z")).toBeCloseTo(base + 306.925, 6);
    expect(parseIsoTime("2026-10-15T16:00:21.3Z")).toBeCloseTo(base + 300, 6);
    expect(parseIsoTime("2026-10-15T16:00:21Z")).toBe(base);
  });

  it("orders two trades inside the same millisecond", () => {
    expect(parseIsoTime("2026-10-15T16:00:21.306100Z")).toBeLessThan(
      parseIsoTime("2026-10-15T16:00:21.306900Z"),
    );
  });
});

describe("parseCoinbaseMessage", () => {
  it("parses a match and flips the maker side to the taker side", () => {
    const e = parseCoinbaseMessage(
      JSON.stringify({
        type: "match",
        trade_id: 1106544962,
        side: "sell",
        size: "0.0060768",
        price: "82344.77",
        product_id: "BTC-USD",
        time: "2026-10-15T16:00:21.306925Z",
      }),
    );
    expect(e).toMatchObject({
      kind: "trade",
      id: 1106544962,
      price: 82344.77,
      size: 0.0060768,
      takerBuy: true,
    });
  });

  it("treats last_match (sent once on subscribe) as a trade", () => {
    const e = parseCoinbaseMessage(
      JSON.stringify({
        type: "last_match",
        trade_id: 7,
        side: "buy",
        size: "1",
        price: "2",
        time: "2026-10-15T16:00:21Z",
      }),
    );
    expect(e).toMatchObject({ kind: "trade", id: 7, takerBuy: false });
  });

  it("parses a book snapshot and level-2 updates", () => {
    const snap = parseCoinbaseMessage(
      JSON.stringify({
        type: "snapshot",
        product_id: "BTC-USD",
        bids: [
          ["82343.28", "0.02732365"],
          ["82342.01", "0.00004372"],
        ],
        asks: [["82344.77", "0.09098745"]],
      }),
    );
    expect(snap).toEqual({
      kind: "book-snapshot",
      bids: [
        [82343.28, 0.02732365],
        [82342.01, 0.00004372],
      ],
      asks: [[82344.77, 0.09098745]],
    });

    const upd = parseCoinbaseMessage(
      JSON.stringify({
        type: "l2update",
        product_id: "BTC-USD",
        changes: [
          ["buy", "82327.00", "1.00000000"],
          ["sell", "82350.10", "0.00000000"],
        ],
        time: "2026-10-15T16:00:21.306925Z",
      }),
    );
    expect(upd).toEqual({
      kind: "book-update",
      changes: [
        { bid: true, price: 82327, size: 1 },
        { bid: false, price: 82350.1, size: 0 },
      ],
    });
  });

  it("parses ticker, heartbeat and subscription frames", () => {
    expect(
      parseCoinbaseMessage(
        JSON.stringify({
          type: "ticker",
          price: "82344.77",
          open_24h: "81545.28",
          high_24h: "82555.08",
          low_24h: "79676.02",
          volume_24h: "7420.83520838",
          time: "2026-10-15T16:00:21.306925Z",
        }),
      ),
    ).toMatchObject({ kind: "ticker", price: 82344.77, open24h: 81545.28 });

    expect(
      parseCoinbaseMessage(JSON.stringify({ type: "heartbeat", time: "2026-10-15T16:00:21Z" })),
    ).toMatchObject({ kind: "heartbeat" });

    const sub = parseCoinbaseMessage(
      JSON.stringify({
        type: "subscriptions",
        channels: [{ name: "ticker" }, { name: "matches" }, { name: "level2_50" }],
      }),
    );
    expect(sub).toEqual({ kind: "subscribed", channels: ["ticker", "matches", "level2_50"] });
    expect(hasBookChannel(["ticker", "level2_50"])).toBe(true);
    expect(hasBookChannel(["ticker", "matches"])).toBe(false);
  });

  it("reports errors and ignores unknown frames", () => {
    expect(
      parseCoinbaseMessage(
        JSON.stringify({ type: "error", message: "Failed to subscribe", reason: "auth required" }),
      ),
    ).toEqual({ kind: "error", message: "Failed to subscribe: auth required" });
    expect(parseCoinbaseMessage("{not json")).toMatchObject({ kind: "error" });
    expect(parseCoinbaseMessage(JSON.stringify({ type: "status" }))).toBeNull();
  });
});

describe("parseRestTrade", () => {
  it("uses the same maker-side rule as the socket", () => {
    expect(
      parseRestTrade({
        trade_id: 1,
        side: "buy",
        size: "0.00000071",
        price: "82353.90000000",
        time: "2026-10-15T16:00:33.549564Z",
      }),
    ).toMatchObject({ id: 1, price: 82353.9, size: 0.00000071, takerBuy: false });
  });
});
