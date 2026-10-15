/** Small seeded PRNG (mulberry32), so the simulated feed is reproducible in tests. */
export class Rng {
  private state: number;
  private spare = NaN;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Standard normal (Box-Muller, caching the second value). */
  normal(): number {
    if (!Number.isNaN(this.spare)) {
      const s = this.spare;
      this.spare = NaN;
      return s;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  /** Exponential with the given mean (waiting time of a Poisson process). */
  exponential(mean: number): number {
    let u = 0;
    while (u === 0) u = this.next();
    return -Math.log(u) * mean;
  }
}
