import { C } from './config.js';
import { isSolid } from './generator.js';
import type { Candle, PlayerState } from './types.js';

export function createPlayer(): PlayerState {
  return {
    x: 0,
    y: 0,
    vy: 0,
    ground: false,
    jumps: 0,
    coy: 0,
    buf: 0,
    short: false,
    flipCd: 0,
    alive: true,
    standIdx: -1,
    lastLandIdx: -1,
  };
}

/**
 * Downward landing sweep. `prevFeet` is the feet position *before* this frame's gravity
 * integration — landing is a crossing test, not an overlap test, so a fast fall cannot
 * tunnel through a candle top.
 *
 * Returns the highest candle crossed (smallest y) so overlapping tops resolve to the one
 * the player visually lands on. Pure: nothing it reads changes while it runs.
 *
 * The horizontal-contact pass that follows it is deliberately *not* factored out — it
 * mutates `stand` mid-loop, which changes `isSolid` for the candles it has yet to visit.
 * It lives inline in `Sim.step` where that ordering is visible.
 */
export function findLanding(
  candles: readonly Candle[],
  p: PlayerState,
  prevFeet: number,
  feet: number,
): Candle | null {
  let land: Candle | null = null;
  for (const c of candles) {
    if (!isSolid(c, p.short, p.standIdx)) continue;
    if (p.x + C.pw <= c.x || p.x >= c.x + c.w) continue;
    if (p.vy >= 0 && prevFeet <= c.y + C.land && feet >= c.y) {
      if (!land || c.y < land.y) land = c;
    }
  }
  return land;
}

/** The nearest solid candle at or ahead of the player — where a stop loss puts you back. */
export function findRecovery(candles: readonly Candle[], p: PlayerState): Candle | null {
  const c = candles.find((k) => isSolid(k, p.short, p.standIdx) && k.x > p.x - 40);
  return c ?? candles[candles.length - 1] ?? null;
}

/**
 * The first non-doji candle in the flip decision window. A flip that puts you on the
 * right side of this one is a "clean flip" and pays.
 */
export function findFlipTarget(candles: readonly Candle[], px: number): Candle | null {
  let ahead: Candle | null = null;
  for (const c of candles) {
    if (c.x > px + 40 && c.x < px + 300 && c.kind !== 'doji') {
      if (!ahead || c.x < ahead.x) ahead = c;
    }
  }
  return ahead;
}
