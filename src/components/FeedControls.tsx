import type { SourcePref } from "../feed/protocol.ts";
import { STALE_CHOICES, engine } from "../engine/engine.ts";
import { useObservable } from "../engine/observable.ts";

const SOURCES: Array<{ pref: SourcePref; label: string; title: string }> = [
  { pref: "auto", label: "Auto", title: "Live Coinbase feed, simulated fallback if it fails" },
  { pref: "live", label: "Live only", title: "Live Coinbase feed, no fallback" },
  { pref: "sim", label: "Simulated", title: "Built-in simulated market" },
];

export function FeedControls() {
  const feed = useObservable(engine.feed);
  const settings = useObservable(engine.settings);
  return (
    <section className="panel controls" aria-labelledby="controls-title">
      <h2 id="controls-title">Feed &amp; tests</h2>
      <div className="control-row">
        <span className="label">Source</span>
        <div className="toolbar" role="group" aria-label="Data source">
          {SOURCES.map((s) => (
            <button
              key={s.pref}
              type="button"
              title={s.title}
              aria-pressed={feed.pref === s.pref}
              onClick={() => engine.setSource(s.pref)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="control-row">
        <span className="label">Stress</span>
        <div className="toolbar">
          <button
            type="button"
            aria-pressed={feed.stress}
            onClick={() => engine.setStress(!feed.stress)}
            title="Simulated feed at 10x the message rate"
          >
            {feed.stress ? "Stop stress test" : "Stress test 10×"}
          </button>
          <button
            type="button"
            onClick={() => engine.prefill(100_000, 30 * 60_000)}
            title="Replaces the chart data with 100,000 simulated trades over 30 minutes, then runs the stress test"
          >
            Load 100k points
          </button>
        </div>
      </div>
      <div className="control-row">
        <span className="label">Failures</span>
        <div className="toolbar">
          <button
            type="button"
            onClick={() => engine.stall(3000)}
            title="The worker holds back all data for 3 s, like a network stall"
          >
            Freeze feed 3 s
          </button>
          <button
            type="button"
            onClick={() => engine.dropSocket()}
            disabled={feed.socket !== "open"}
            title="Close the WebSocket to test the fallback and reconnect"
          >
            Drop socket
          </button>
        </div>
      </div>
      <div className="control-row">
        <label className="label" htmlFor="stale-after">
          Stale after
        </label>
        <select
          id="stale-after"
          value={settings.staleMs}
          onChange={(e) => engine.setStaleMs(Number(e.target.value))}
        >
          {STALE_CHOICES.map((ms) => (
            <option key={ms} value={ms}>
              {ms < 1000 ? `${ms} ms` : `${ms / 1000} s`}
            </option>
          ))}
        </select>
        <span className="muted small">without any new message, data is marked stale</span>
      </div>
    </section>
  );
}
