import { engine } from "../engine/engine.ts";
import { useObservable } from "../engine/observable.ts";
import { REPLAY_SPEEDS } from "../engine/replay.ts";
import { POINT_CAPACITY } from "../engine/store.ts";
import { formatCount } from "../lib/format.ts";
import { useMount } from "./useMount.ts";

function ReplayControls() {
  const ui = useObservable(engine.replay.ui);
  const ref = useMount<HTMLDivElement>(engine.replay);
  return (
    <div className="replay-controls" ref={ref}>
      <div className="toolbar" role="group" aria-label="Replay controls">
        <button
          type="button"
          onClick={() => engine.replay.step(-1)}
          title="Previous trade"
          aria-label="Step back one trade"
        >
          ⏮
        </button>
        <button
          type="button"
          className="play"
          onClick={() => engine.replay.togglePlay()}
          aria-label={ui.playing ? "Pause" : "Play"}
        >
          {ui.playing ? "⏸ Pause" : ui.atEnd ? "↺ Play again" : "▶ Play"}
        </button>
        <button
          type="button"
          onClick={() => engine.replay.step(1)}
          title="Next trade"
          aria-label="Step forward one trade"
        >
          ⏭
        </button>
      </div>
      <div className="toolbar" role="group" aria-label="Replay speed">
        {REPLAY_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={ui.speed === s}
            onClick={() => engine.replay.setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
      <input
        className="scrubber"
        type="range"
        step="any"
        data-replay="scrubber"
        aria-label="Replay position"
      />
      <span className="replay-time" data-replay="time" />
      <span className="muted small" data-replay="behind" />
      <button type="button" className="exit" onClick={() => engine.exitReplay()}>
        ✕ Back to live
      </button>
    </div>
  );
}

export function ReplayBar() {
  const ui = useObservable(engine.replay.ui);
  return (
    <section className="panel replay" aria-label="Replay">
      {ui.active ? (
        <ReplayControls />
      ) : (
        <div className="replay-idle">
          <button type="button" onClick={() => engine.enterReplay()}>
            ⏺ Replay this session
          </button>
          <span className="muted small">
            Recording is always on: the last {formatCount(POINT_CAPACITY)} trades and the order book
            once a second (30 min). Live data keeps recording while you replay.
          </span>
        </div>
      )}
    </section>
  );
}
