import { formatFixed, formatPrice, formatTimeUTC } from "../lib/format.ts";
import { freshness } from "../lib/staleness.ts";
import type { DepthSource } from "./depthChart.ts";
import type { FrameTask } from "./frameLoop.ts";
import type { ChartClock } from "./priceChart.ts";
import type { MarketStore } from "./store.ts";

const EVERY_MS = 100;

export interface StatusModes {
  staleMs(): number;
  /** Replay state, or null when live. */
  replay(): { cursor: number; behindMs: number; playing: boolean; speed: number } | null;
}

function setText(el: HTMLElement | undefined, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

function setData(el: HTMLElement | undefined, key: string, value: string): void {
  if (el && el.dataset[key] !== value) el.dataset[key] = value;
}

/**
 * Header quote and the stale-data badge, written straight to the DOM 10
 * times a second. The badge compares the age of the newest delivered data
 * with the threshold; when it is too old, the price is marked stale and
 * shows "as of" its time, so old data is never presented as current.
 */
export class StatusBar implements FrameTask {
  readonly name = "status";
  private readonly store: MarketStore;
  private readonly clock: ChartClock;
  private readonly depth: DepthSource;
  private readonly modes: StatusModes;
  private readonly el = new Map<string, HTMLElement>();
  private mounted = false;
  private last = 0;
  private lastPoints = -1;

  constructor(store: MarketStore, clock: ChartClock, depth: DepthSource, modes: StatusModes) {
    this.store = store;
    this.clock = clock;
    this.depth = depth;
    this.modes = modes;
  }

  mount(root: HTMLElement): void {
    for (const node of root.querySelectorAll<HTMLElement>("[data-status]")) {
      this.el.set(node.dataset.status ?? "", node);
    }
    this.mounted = true;
  }

  unmount(): void {
    this.el.clear();
    this.mounted = false;
  }

  frame(now: number): void {
    if (!this.mounted) return;
    // A new trade updates the price at once; otherwise the age ticks at 10 Hz.
    const pv = this.store.pointsVersion;
    if (pv === this.lastPoints && now - this.last < EVERY_MS) return;
    this.lastPoints = pv;
    this.last = now;
    const e = this.el;
    const status = this.store.status;
    const replay = this.modes.replay();

    // Badge: replay, or fresh / stale / no data.
    const badge = e.get("badge");
    if (replay) {
      setData(badge, "kind", "replay");
      setText(e.get("badgeShape"), replay.playing ? "▶" : "‖");
      setText(
        e.get("badgeText"),
        `Replay ${formatTimeUTC(replay.cursor)} · ${formatFixed(replay.speed, replay.speed < 1 ? 1 : 0)}×`,
      );
    } else {
      const f = freshness(Date.now(), status?.dataAsOf ?? null, this.modes.staleMs());
      setData(badge, "kind", f.kind);
      setText(e.get("badgeShape"), f.kind === "fresh" ? "●" : f.kind === "stale" ? "⚠" : "○");
      setText(e.get("badgeText"), f.label);
    }

    // Last price, tick direction, and whether it may be called current.
    const pts = this.store.points;
    const limit = this.clock.limit();
    const n = Number.isFinite(limit) ? pts.upperBound(limit) : pts.length;
    const quote = e.get("quote");
    if (n === 0) {
      setText(e.get("price"), "—");
      setText(e.get("arrow"), "");
      setData(quote, "dir", "flat");
    } else {
      const last = pts.priceAt(n - 1);
      let dir = 0;
      for (let i = n - 2; i >= Math.max(0, n - 200); i--) {
        const q = pts.priceAt(i);
        if (q !== last) {
          dir = last > q ? 1 : -1;
          break;
        }
      }
      setText(e.get("price"), formatPrice(last));
      setText(e.get("arrow"), dir > 0 ? "▲" : dir < 0 ? "▼" : "•");
      setData(quote, "dir", dir > 0 ? "up" : dir < 0 ? "down" : "flat");
      const stale = !replay && badge?.dataset.kind === "stale";
      setData(quote, "stale", stale ? "true" : "false");
      const asOf = replay
        ? `replayed, ${formatTimeUTC(pts.timeAt(n - 1), "s")} UTC`
        : stale
          ? `as of ${formatTimeUTC(pts.timeAt(n - 1), "s")} UTC · not current`
          : "";
      setText(e.get("asof"), asOf);

      // 24 h change from the exchange ticker: only for live data.
      const t = status?.ticker;
      if (t && !replay && status?.source === "live" && t.open24h > 0) {
        const diff = last - t.open24h;
        const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "•";
        setText(
          e.get("change"),
          `${arrow} ${formatFixed(diff, 2, { sign: true })} (${formatFixed((diff / t.open24h) * 100, 2, { sign: true })} %) 24h`,
        );
        setData(e.get("change"), "dir", diff > 0 ? "up" : diff < 0 ? "down" : "flat");
      } else {
        setText(e.get("change"), "");
      }
    }

    const d = this.depth.depth();
    setText(
      e.get("book"),
      d
        ? `Bid ${formatPrice(d.bestBid)} · Ask ${formatPrice(d.bestAsk)} · Spread ${formatFixed(d.bestAsk - d.bestBid, 2)}`
        : "",
    );
  }
}
