/**
 * Seeded pseudo-randomness for everything that can move a score.
 *
 * Cosmetic randomness (particles, weather, star field, wick lengths, bob phases)
 * must NOT come through here — it lives in the renderer and may use Math.random().
 * Anything drawn from this generator changes the world, and therefore changes money.
 */

/** mulberry32 — small, fast, well-distributed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * mulberry32 with an inspectable, restorable state.
 *
 * The state is a single uint32, which is what makes a Sim snapshot cheap and a
 * divergence easy to bisect: two runs that disagree can be compared draw by draw.
 */
export class Random {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let a = (this.a + 0x6d2b79f5) >>> 0;
    this.a = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [lo, hi) — the prototype's `rnd()`. */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  /** Uniform integer in [lo, hi] inclusive — the prototype's `ri()`. */
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }

  getState(): number {
    return this.a;
  }

  setState(v: number): void {
    this.a = v >>> 0;
  }
}
