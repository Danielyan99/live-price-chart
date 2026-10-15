/** Shared Canvas 2D helpers: DPR-aware layers, crisp lines, patterns, shapes. */

export const COLORS = {
  panel: "#121820",
  grid: "rgba(255,255,255,0.065)",
  axisLine: "rgba(255,255,255,0.18)",
  axisText: "#8d9aa8",
  text: "#e6edf3",
  line: "#4cc9f0",
  lineFill: "rgba(76,201,240,0.10)",
  up: "#2fbf71",
  down: "#f0616d",
  flat: "#8d9aa8",
  sim: "#f2b84b",
  crosshair: "rgba(230,237,243,0.55)",
  tooltipBg: "rgba(8,12,16,0.94)",
  tooltipBorder: "rgba(255,255,255,0.16)",
  budget: "#f2b84b",
};

/** Monospace digits so numbers keep their width (canvas has no tabular-nums). */
export const FONT = '11px ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace';
export const FONT_BOLD = `600 ${FONT}`;

/** One canvas sized for devicePixelRatio. Drawing uses CSS pixels. */
export class Layer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;
  dpr = 1;

  constructor(className: string, opaque = false) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = className;
    const ctx = this.canvas.getContext("2d", { alpha: !opaque });
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
  }

  /** Returns true when the backing store changed (everything must redraw). */
  resize(width: number, height: number, dpr: number): boolean {
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width === w && this.canvas.height === h && this.dpr === dpr) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    return true;
  }

  /** Resets the transform to CSS pixels and clears. */
  begin(): CanvasRenderingContext2D {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    return ctx;
  }
}

/** Centre of the device pixel at CSS coordinate v, so 1px lines are sharp. */
export function crisp(v: number, dpr: number): number {
  return (Math.floor(v * dpr) + 0.5) / dpr;
}

export type PatternKind = "forward" | "backward" | "dots";

const patterns = new Map<string, CanvasPattern>();

/**
 * Fill patterns so meaning never depends on colour alone: bids and asks (or
 * simulated regions) differ by texture as well. Tiles are made at device
 * resolution and scaled back, so they stay sharp on HiDPI screens.
 */
export function pattern(
  ctx: CanvasRenderingContext2D,
  kind: PatternKind,
  color: string,
  dpr: number,
  spacing = 6,
): CanvasPattern | string {
  const key = `${kind}|${color}|${dpr}|${spacing}`;
  const cached = patterns.get(key);
  if (cached) return cached;
  const size = Math.max(2, Math.round(spacing * dpr));
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const t = tile.getContext("2d");
  if (!t) return color;
  t.strokeStyle = color;
  t.fillStyle = color;
  t.lineWidth = Math.max(1, dpr);
  if (kind === "dots") {
    t.beginPath();
    t.arc(size / 2, size / 2, Math.max(0.8, dpr * 0.9), 0, Math.PI * 2);
    t.fill();
  } else {
    // Three strokes so the diagonal joins up across tile edges.
    t.beginPath();
    for (const o of [-size, 0, size]) {
      if (kind === "forward") {
        t.moveTo(o, size);
        t.lineTo(o + size, 0);
      } else {
        t.moveTo(o, 0);
        t.lineTo(o + size, size);
      }
    }
    t.stroke();
  }
  const p = ctx.createPattern(tile, "repeat");
  if (!p) return color;
  p.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
  patterns.set(key, p);
  return p;
}

/** Up or down triangle centred on (x, y): direction shown by shape, not colour. */
export function triangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  up: boolean,
): void {
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y + r * 0.8);
    ctx.lineTo(x - r, y + r * 0.8);
  } else {
    ctx.moveTo(x, y + r);
    ctx.lineTo(x + r, y - r * 0.8);
    ctx.lineTo(x - r, y - r * 0.8);
  }
  ctx.closePath();
}

/** Rounded label box with text, used for axis tags and tooltips. */
export function tag(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bg: string,
  fg: string,
  align: "left" | "center" = "left",
): void {
  const w = ctx.measureText(text).width + 10;
  const h = 17;
  const left = align === "center" ? x - w / 2 : x;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(left, y - h / 2, w, h, 3);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + 5, y + 0.5);
}
