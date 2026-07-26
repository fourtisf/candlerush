export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Frame-rate independent exponential approach, ported verbatim from the prototype's
 * `1 - Math.pow(k, dt)` idiom. `dt` is always the fixed step, so this is constant —
 * it is kept in this form so the numbers stay recognisably the tuned ones.
 */
export const approach = (k: number, dt: number): number => 1 - Math.pow(k, dt);
