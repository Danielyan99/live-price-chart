import { engine, type FeedUi } from "../engine/engine.ts";
import { useObservable } from "../engine/observable.ts";

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
  const source = sourceText(feed);
  return (
    <header className="app-header">
      <div className="title">
        <h1>Live price chart</h1>
        <span className="muted">BTC-USD · Canvas 2D by hand · data in a Web Worker</span>
      </div>
      <div className="status-row" aria-live="polite">
        <span className={`badge badge-${source.kind}`}>
          <span className="shape" aria-hidden="true">
            {source.kind === "live" ? "●" : source.kind === "sim" ? "◆" : "○"}
          </span>
          {source.text}
        </span>
        {feed.bookSource === "sim" && feed.source === "live" && (
          <span className="badge badge-sim">Order book simulated (no live book channel)</span>
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
