import { engine } from "../engine/engine.ts";
import { useMount } from "./useMount.ts";

/** Static skeleton; the engine writes the numbers (no React render per frame). */
export function PerfPanel() {
  const ref = useMount<HTMLElement>(engine.perfPanel);
  return (
    <section className="panel perf" ref={ref} aria-labelledby="perf-title">
      <div className="panel-head">
        <h2 id="perf-title">Frame budget</h2>
        <span className="muted">draw time per frame, last 120 frames</span>
      </div>
      <div className="spark-holder" data-spark aria-hidden="true" />
      <dl className="stats">
        <dt>FPS</dt>
        <dd data-perf="fps">{"—"}</dd>
        <dt>Draw avg</dt>
        <dd data-perf="avg">{"—"}</dd>
        <dt>Draw p95</dt>
        <dd data-perf="p95">{"—"}</dd>
        <dt>Draw max</dt>
        <dd data-perf="max">{"—"}</dd>
        <dt>Budget used</dt>
        <dd data-perf="budget">{"—"}</dd>
        <dt>Over budget</dt>
        <dd data-perf="over">{"—"}</dd>
        <dt>Dropped (10 s)</dt>
        <dd data-perf="dropped">{"—"}</dd>
        <dt>Points in view</dt>
        <dd data-perf="inview">{"—"}</dd>
        <dt>Vertices drawn</dt>
        <dd data-perf="vertices">{"—"}</dd>
        <dt>Ring buffer</dt>
        <dd data-perf="buffer">{"—"}</dd>
        <dt>Buffer memory</dt>
        <dd data-perf="buffermem">{"—"}</dd>
        <dt>Messages/s</dt>
        <dd data-perf="msgs">{"—"}</dd>
        <dt>Trades/s</dt>
        <dd data-perf="trades">{"—"}</dd>
        <dt>Socket</dt>
        <dd data-perf="kb">{"—"}</dd>
        <dt>Worker busy</dt>
        <dd data-perf="worker">{"—"}</dd>
        <dt>Main ingest</dt>
        <dd data-perf="ingest">{"—"}</dd>
        <dt>JS heap</dt>
        <dd data-perf="heap">{"—"}</dd>
      </dl>
      <p className="muted small">
        Per layer, ms/frame: <span data-perf="tasks">{"—"}</span>
      </p>
    </section>
  );
}
