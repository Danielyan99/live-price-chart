import { useEffect, useState } from "react";
import { engine } from "./engine/engine.ts";
import { useObservable } from "./engine/observable.ts";

// Temporary data-layer check; replaced by the real dashboard in step 3.
export function App() {
  const feed = useObservable(engine.feed);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const { store } = engine;
  const s = store.status;
  return (
    <main>
      <h1>Live price chart</h1>
      <pre>
        {JSON.stringify(
          {
            ...feed,
            points: store.points.length,
            lastPrice: store.points.length ? store.points.priceAt(store.points.length - 1) : null,
            msgsPerSec: s?.msgsPerSec,
            tradesPerSec: s?.tradesPerSec,
            clockOffset: s?.clockOffset,
            bestBid: store.depth?.bestBid,
            bestAsk: store.depth?.bestAsk,
            depthPoints: store.depth
              ? [store.depth.bidPrices.length, store.depth.askPrices.length]
              : null,
            ageMs: s ? Date.now() - s.dataAsOf : null,
          },
          null,
          2,
        )}
      </pre>
      <button onClick={() => engine.setSource("auto")}>Auto</button>
      <button onClick={() => engine.setSource("sim")}>Sim</button>
      <button onClick={() => engine.setStress(!feed.stress)}>Stress</button>
      <button onClick={() => engine.dropSocket()}>Drop socket</button>
      <button onClick={() => engine.stall(3000)}>Stall 3 s</button>
      <button onClick={() => engine.prefill(100_000, 30 * 60_000)}>Prefill 100k</button>
    </main>
  );
}
