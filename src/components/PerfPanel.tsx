import { engine, type MeasureReport } from "../engine/engine.ts";
import { useObservable } from "../engine/observable.ts";
import { formatCount, formatFixed } from "../lib/format.ts";
import { useMount } from "./useMount.ts";

function Report({ r }: { r: MeasureReport }) {
  const what = r.replay
    ? "replay"
    : r.source === "sim"
      ? r.stress
        ? "simulated feed, stress 10×"
        : "simulated feed"
      : "live feed";
  return (
    <div className="report" aria-live="polite">
      <p className="small">
        <strong>
          {r.seconds} s, {what}:
        </strong>{" "}
        {formatFixed(r.fps, 0)} FPS · draw avg {formatFixed(r.avg, 2)} ms · p95{" "}
        {formatFixed(r.p95, 2)} ms · p99 {formatFixed(r.p99, 2)} ms · max {formatFixed(r.max, 1)} ms
        · {r.overBudget} of {formatCount(r.frames)} frames over budget · {r.slowFrames} slow frames
        · {formatCount(r.pointsInView)} points in view → {formatCount(r.verticesDrawn)} vertices ·{" "}
        {formatCount(r.msgsPerSec)} msg/s
      </p>
    </div>
  );
}

/** Static skeleton; the engine writes the numbers (no React render per frame). */
export function PerfPanel() {
  const ref = useMount<HTMLElement>(engine.perfPanel);
  const m = useObservable(engine.measurement);
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
      <div className="measure">
        <button type="button" disabled={m.running} onClick={() => void engine.measure(10)}>
          {m.running ? "Measuring… (10 s)" : "Measure 10 s"}
        </button>
        <span className="muted small">records every frame, then summarises</span>
      </div>
      {m.report && <Report r={m.report} />}
    </section>
  );
}
