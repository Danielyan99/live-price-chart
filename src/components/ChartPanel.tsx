import { engine } from "../engine/engine.ts";
import { useObservable } from "../engine/observable.ts";
import { RANGE_PRESETS } from "../engine/priceChart.ts";
import { useMount } from "./useMount.ts";

export function ChartPanel() {
  const view = useObservable(engine.chart.view);
  const hostRef = useMount<HTMLDivElement>(engine.chart);
  return (
    <section className="panel chart-panel" aria-labelledby="chart-title">
      <div className="panel-head">
        <h2 id="chart-title">BTC-USD trades</h2>
        <div className="toolbar" role="group" aria-label="Time range">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={view.preset === p.label}
              onClick={() => engine.chart.setPreset(p.label)}
            >
              {p.label}
            </button>
          ))}
          <button type="button" onClick={() => engine.chart.zoom(1 / 1.5)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => engine.chart.zoom(1.5)} aria-label="Zoom out">
            {"−"}
          </button>
          <button
            type="button"
            className="follow"
            aria-pressed={view.follow}
            onClick={engine.chart.goLive}
            title="Follow the newest data (End key, or double-click the chart)"
          >
            {view.follow ? "● Following" : "▶ Back to now"}
          </button>
        </div>
      </div>
      <div className="chart-host" ref={hostRef} />
      <p className="hint">
        Drag to pan, wheel or pinch to zoom, hover for exact trade. Step line: between trades the
        price is the last trade, nothing is invented. Hatched amber = simulated data.
      </p>
    </section>
  );
}
