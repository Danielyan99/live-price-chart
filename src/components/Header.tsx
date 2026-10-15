import { engine, type FeedUi } from "../engine/engine.ts";
import { useObservable } from "../engine/observable.ts";
import { useMount } from "./useMount.ts";

function sourceText(feed: FeedUi): { text: string; kind: "live" | "sim" | "off" } {
  if (feed.source === "live") return { text: "LIVE · Coinbase", kind: "live" };
  if (feed.source === "sim") {
    const why = feed.stress ? "stress test 10×" : feed.pref === "sim" ? "chosen" : "live feed down";
    return { text: `SIMULATED · ${why}`, kind: "sim" };
  }
  if (feed.socket === "connecting") return { text: "Connecting…", kind: "off" };
  return { text: "No data source", kind: "off" };
}

export function Header() {
  const feed = useObservable(engine.feed);
  const ref = useMount<HTMLElement>(engine.statusBar);
  const source = sourceText(feed);
  return (
    <header className="app-header" ref={ref}>
      <div className="title">
        <h1>Live price chart</h1>
        <span className="muted">BTC-USD · Canvas 2D by hand · data in a Web Worker</span>
      </div>
      <div className="quote" data-status="quote" data-dir="flat" data-stale="false">
        <span className="quote-price">
          <span className="arrow" data-status="arrow" aria-hidden="true" />
          <span data-status="price">—</span>
          <span className="unit">USD</span>
        </span>
        <span className="quote-change" data-status="change" />
        <span className="quote-asof" data-status="asof" />
        <span className="quote-book muted" data-status="book" />
      </div>
      <div className="status-row">
        <span className="badge freshness" data-status="badge" data-kind="none" role="status">
          <span className="shape" data-status="badgeShape" aria-hidden="true">
            ○
          </span>
          <span data-status="badgeText">No data yet</span>
        </span>
        <span className={`badge badge-${source.kind}`} role="status">
          <span className="shape" aria-hidden="true">
            {source.kind === "live" ? "●" : source.kind === "sim" ? "◆" : "○"}
          </span>
          {source.text}
        </span>
        {feed.bookSource === "sim" && feed.source === "live" && (
          <span className="badge badge-sim">Order book simulated (no live book channel)</span>
        )}
        {feed.backfill === "loading" && (
          <span className="muted small">Loading 10k recent trades…</span>
        )}
        {feed.lastError && feed.source !== "live" && (
          <span className="muted small">
            {feed.lastError}
            {feed.retryAt ? " · retrying" : ""}
          </span>
        )}
      </div>
    </header>
  );
}
