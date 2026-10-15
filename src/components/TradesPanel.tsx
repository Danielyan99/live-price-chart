import { useEffect, useRef } from "react";
import { engine } from "../engine/engine.ts";
import { TRADE_ROWS } from "../engine/tradesTable.ts";

const ROW_KEYS = Array.from({ length: TRADE_ROWS }, (_, i) => i);

/** A fixed pool of rows rendered once; the engine fills them (no React render per trade). */
export function TradesPanel() {
  const ref = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    engine.trades.mount(el);
    return () => engine.trades.unmount();
  }, []);
  return (
    <section className="panel trades" aria-labelledby="trades-title">
      <div className="panel-head">
        <h2 id="trades-title">Last {TRADE_ROWS} trades</h2>
        <span className="muted small">▲ taker bought · ▼ taker sold</span>
      </div>
      <div className="trades-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Time UTC</th>
              <th scope="col">Side</th>
              <th scope="col" className="num">
                Price USD
              </th>
              <th scope="col" className="num">
                Size BTC
              </th>
            </tr>
          </thead>
          <tbody ref={ref}>
            {ROW_KEYS.map((k) => (
              <tr key={k} hidden>
                <td className="t-time" />
                <td className="t-side" />
                <td className="num t-price">
                  <span className="int" />
                  <span className="frac" />
                </td>
                <td className="num t-size">
                  <span className="int" />
                  <span className="dec">
                    <span className="frac" />
                    <span className="pad" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
