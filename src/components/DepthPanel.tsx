import { DEPTH_RANGES, engine } from "../engine/engine.ts";
import { useObservable } from "../engine/observable.ts";
import { useMount } from "./useMount.ts";

export function DepthPanel() {
  const settings = useObservable(engine.settings);
  const ref = useMount<HTMLDivElement>(engine.depthChart);
  return (
    <section className="panel depth" aria-labelledby="depth-title">
      <div className="panel-head">
        <h2 id="depth-title">Order book depth</h2>
        <div className="toolbar" role="group" aria-label="Depth range around the mid price">
          {DEPTH_RANGES.map((pct) => (
            <button
              key={pct}
              type="button"
              aria-pressed={settings.depthRangePct === pct}
              onClick={() => engine.setDepthRange(pct)}
            >
              ±{pct} %
            </button>
          ))}
        </div>
      </div>
      <div className="depth-host" ref={ref} />
    </section>
  );
}
