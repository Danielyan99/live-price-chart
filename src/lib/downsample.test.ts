import { describe, expect, it } from "vitest";
import { MinMaxDownsampler } from "./downsample.ts";
import { Rng } from "./rng.ts";

function randomWalk(n: number, seed: number, t0 = 0, dt = 1) {
  const rng = new Rng(seed);
  const t: number[] = [];
  const p: number[] = [];
  const spikes: number[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price += rng.normal() * 0.1;
    // One-trade spikes every 997 points (so never two in one column):
    // the kind of point that naive "every Nth point" sampling loses.
    const spike = i % 997 === 500 ? (spikes.length % 2 === 0 ? 50 : -50) : 0;
    if (spike !== 0) spikes.push(i);
    t.push(t0 + i * dt);
    p.push(price + spike);
  }
  return { t, p, spikes };
}

function run(t: number[], p: number[], xMin: number, xMax: number, columns: number) {
  const ds = new MinMaxDownsampler();
  ds.begin(xMin, xMax, columns, t.length);
  for (let i = 0; i < t.length; i++) ds.add(t[i], p[i]);
  ds.end();
  return {
    ds,
    vt: Array.from(ds.t.subarray(0, ds.count)),
    vp: Array.from(ds.p.subarray(0, ds.count)),
  };
}

describe("MinMaxDownsampler", () => {
  it("keeps the min and max of every pixel column", () => {
    const n = 50_000;
    const columns = 300;
    const { t, p } = randomWalk(n, 1);
    const { ds, vt, vp } = run(t, p, 0, n, columns);

    expect(ds.count).toBeLessThanOrEqual(4 * columns);
    expect(ds.count).toBeGreaterThan(columns); // it did aggregate, not drop

    const scale = columns / n;
    for (let c = 0; c < columns; c++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < n; i++) {
        if (Math.floor(t[i] * scale) === c) {
          lo = Math.min(lo, p[i]);
          hi = Math.max(hi, p[i]);
        }
      }
      const inCol = vp.filter((_, k) => Math.floor(vt[k] * scale) === c);
      expect(Math.min(...inCol)).toBe(lo);
      expect(Math.max(...inCol)).toBe(hi);
    }
  });

  it("keeps every spike, the first and the last point, in time order", () => {
    const { t, p, spikes } = randomWalk(20_000, 2);
    const { vt, vp } = run(t, p, 0, 20_000, 100);
    expect(spikes.length).toBe(20);
    expect(vt[0]).toBe(t[0]);
    expect(vp[0]).toBe(p[0]);
    expect(vt[vt.length - 1]).toBe(t[t.length - 1]);
    for (let k = 1; k < vt.length; k++) expect(vt[k]).toBeGreaterThan(vt[k - 1]);
    // A one-trade spike is its column's min or max, so it must survive.
    for (const i of spikes) expect(vt).toContain(t[i]);
  });

  it("passes points through untouched when there are fewer points than pixels", () => {
    const { t, p } = randomWalk(150, 3);
    const { vt, vp } = run(t, p, 0, 150, 800);
    expect(vt).toEqual(t);
    expect(vp).toEqual(p);
  });

  it("reports min/max only for points inside the view", () => {
    const t = [-10, 0, 5, 10, 20];
    const p = [1, 50, 60, 55, 999];
    const { ds } = run(t, p, 0, 10, 2);
    expect(ds.min).toBe(50);
    expect(ds.max).toBe(60);
    expect(ds.inView).toBe(3);
    expect(ds.seen).toBe(5);
  });

  it("addRange gives exactly the same output as add(), also across two segments", () => {
    const { t, p } = randomWalk(30_000, 4);
    const T = Float64Array.from(t);
    const P = Float64Array.from(p);
    for (const columns of [50, 700, 40_000]) {
      const a = new MinMaxDownsampler();
      a.begin(1000, 25_000, columns, t.length);
      for (let i = 0; i < t.length; i++) a.add(t[i], p[i]);
      a.end();
      const b = new MinMaxDownsampler();
      b.begin(1000, 25_000, columns, t.length);
      b.addRange(T, P, 0, 12_345); // a wrapped ring buffer arrives in two parts
      b.addRange(T, P, 12_345, t.length);
      b.end();
      expect(Array.from(b.t.subarray(0, b.count))).toEqual(Array.from(a.t.subarray(0, a.count)));
      expect(Array.from(b.p.subarray(0, b.count))).toEqual(Array.from(a.p.subarray(0, a.count)));
      expect([b.min, b.max, b.inView, b.seen]).toEqual([a.min, a.max, a.inView, a.seen]);
    }
  });

  it("can be reused across passes without stale state", () => {
    const ds = new MinMaxDownsampler();
    ds.begin(0, 10, 2, 100);
    for (let i = 0; i < 100; i++) ds.add(i / 10, i);
    ds.end();
    ds.begin(0, 10, 5, 3); // 3 points, 5 columns: pass-through
    ds.add(1, 7);
    ds.add(2, 8);
    ds.add(3, 9);
    ds.end();
    expect(Array.from(ds.p.subarray(0, ds.count))).toEqual([7, 8, 9]);
    expect(ds.min).toBe(7);
  });
});
