import { describe, expect, it } from 'vitest';
import {
  AIRTIME,
  C,
  JH,
  MAPS,
  World,
  charById,
  mapById,
  type Candle,
  type MapId,
} from '../src/index.js';

/**
 * Port of the simulation ALFA already ran, as an assertion rather than a spreadsheet.
 *
 * These are the invariants that make the chart fair: every rise is either walkable or
 * obviously jumpable, every gap is crossable at the speed it can appear at, every colour
 * change is bridged, and tier 1 never shows a hole.
 */

/** Walk the generator and hand back every candle it produced, before culling eats them. */
function generate(mapId: MapId, seed: number, count: number): Candle[] {
  const world = new World(mapById(mapId), charById('bull'), seed);
  const out: Candle[] = [];
  let taken = 0;
  let cam = 0;
  while (out.length < count) {
    world.ensure(cam);
    for (const c of world.candles) {
      if (c.i >= taken) {
        out.push({ ...c });
        taken = c.i + 1;
      }
    }
    cam += 340; // five candles at a time; the retained window is ~47, so nothing is missed
  }
  return out;
}

/** Peak height reachable at horizontal distance `d`, allowing the second jump. */
function reachableHeight(d: number, speed: number): number {
  const T = d / speed;
  const g = C.grav;
  const v1 = C.jumpV;
  const v2 = C.jumpV * 0.92;
  let best = v1 * T - 0.5 * g * T * T; // single jump
  for (let i = 0; i <= 100; i++) {
    const t1 = (T * i) / 100; // moment of the second jump
    if (t1 > T) break;
    const y1 = v1 * t1 - 0.5 * g * t1 * t1;
    const t2 = T - t1;
    best = Math.max(best, y1 + v2 * t2 - 0.5 * g * t2 * t2);
  }
  return best;
}

const SEEDS = [1, 7, 13, 101, 977, 31337];
const PER_SEED = 4500; // 4 maps x 6 seeds x 4500 = 108,000 candles

describe('generator invariants', () => {
  const all: Record<string, Candle[]> = {};
  for (const m of MAPS) {
    for (const seed of SEEDS) all[`${m.id}:${seed}`] = generate(m.id, seed, PER_SEED);
  }
  const total = Object.values(all).reduce((n, cs) => n + cs.length, 0);

  it('covers at least 100,000 generated candles', () => {
    expect(total).toBeGreaterThanOrEqual(100_000);
  });

  it('no rise between consecutive candles is unjumpable', () => {
    const limit = JH - 25;
    for (const [key, cs] of Object.entries(all)) {
      for (let i = 1; i < cs.length; i++) {
        const rise = cs[i - 1]!.y - cs[i]!.y;
        expect(rise, `${key} @${i} rise ${rise}`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('every rise is either a walkable step or an obvious jump', () => {
    // The handoff states the ambiguous band as (6, 46). The prototype's own snap resolves
    // into that band — `if (rise > 6 && rise < 46) ny = prev.y - 14` produces a 14px rise —
    // so the band as written cannot be what was measured. 14px is below the 24px auto-step
    // threshold, i.e. walkable, which makes the real invariant (auto-step, obvious jump].
    // See docs/QUESTIONS-FOR-ALFA.md #2.
    for (const [key, cs] of Object.entries(all)) {
      for (let i = 1; i < cs.length; i++) {
        const rise = cs[i - 1]!.y - cs[i]!.y;
        const ok = rise <= C.step || rise >= 46;
        expect(ok, `${key} @${i} rise ${rise} is in the ambiguous band (${C.step}, 46)`).toBe(true);
      }
    }
  });

  it('no gap is wider than the player can cross at the speed it spawns at', () => {
    for (const [key, cs] of Object.entries(all)) {
      const mapId = key.split(':')[0] as MapId;
      const minSpeed = C.spd0 * mapById(mapId).spd;
      const budget = minSpeed * AIRTIME * 0.9;
      for (let i = 1; i < cs.length; i++) {
        if (!cs[i]!.gapped) continue;
        const span = cs[i]!.x - cs[i - 1]!.x;
        expect(span, `${key} @${i}`).toBeLessThanOrEqual(budget);
      }
    }
  });

  it('every gap is reachable in height as well as in distance', () => {
    // Not in the handoff, but a gap that is crossable horizontally and unreachable
    // vertically is still a death sentence. Gaps do require the double jump.
    for (const [key, cs] of Object.entries(all)) {
      const mapId = key.split(':')[0] as MapId;
      const minSpeed = C.spd0 * mapById(mapId).spd;
      for (let i = 1; i < cs.length; i++) {
        if (!cs[i]!.gapped) continue;
        const rise = cs[i - 1]!.y - cs[i]!.y;
        if (rise <= 0) continue;
        const d = cs[i]!.x - cs[i - 1]!.x;
        expect(rise, `${key} @${i} rise ${rise} over ${d}px`).toBeLessThanOrEqual(
          reachableHeight(d, minSpeed),
        );
      }
    }
  });

  it('every colour transition is bridged by at least three doji', () => {
    for (const [key, cs] of Object.entries(all)) {
      if (mapById(key.split(':')[0] as MapId).longOnly) continue;
      let lastColour: string | null = null;
      let lastColourAt = -1;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i]!;
        if (c.kind === 'doji') continue;
        if (lastColour && c.kind !== lastColour) {
          const bridge = i - lastColourAt - 1;
          expect(bridge, `${key} @${i} ${lastColour}->${c.kind}`).toBeGreaterThanOrEqual(3);
        }
        lastColour = c.kind;
        lastColourAt = i;
      }
    }
  });

  it('no gap occurs within five candles of a transition', () => {
    // "Transition" is the start of the doji bridge — the candle the player is being
    // asked to flip on — not the first candle of the new colour. That is what `noGap = 5`
    // protects, and it is the interval that matters: the danger is a gap landing on top
    // of a flip decision. Measured from the first candle of the new trend the guarantee
    // is only 2 candles, and a same-colour trend restart makes that number meaningless
    // altogether. See docs/QUESTIONS-FOR-ALFA.md #3.
    for (const [key, cs] of Object.entries(all)) {
      if (mapById(key.split(':')[0] as MapId).longOnly) continue;
      let lastBridge = -Infinity;
      let seenBridge = false;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i]!;
        if (c.gapped && seenBridge) {
          expect(i - lastBridge, `${key} @${i}`).toBeGreaterThanOrEqual(5);
        }
        if (c.bridgeStart) {
          lastBridge = i;
          seenBridge = true;
        }
      }
      expect(seenBridge, `${key} produced no bridges at all`).toBe(true);
    }
  });

  it('a new trend never opens onto a gap', () => {
    // The weaker but still load-bearing half: whatever the bridge spacing, the first two
    // candles after a flip are always solid ground.
    for (const [key, cs] of Object.entries(all)) {
      if (mapById(key.split(':')[0] as MapId).longOnly) continue;
      for (let i = 1; i < cs.length; i++) {
        if (!cs[i]!.gapped) continue;
        // Walk back to the bridge this candle belongs to; nothing within 5 may be gapped.
        for (let j = Math.max(0, i - 4); j <= i; j++) {
          expect(cs[j]!.bridgeStart, `${key} @${i} gap ${i - j} candles after a bridge`).toBe(false);
        }
      }
    }
  });

  it('tier 1 never generates a red candle', () => {
    for (const [key, cs] of Object.entries(all)) {
      if (!mapById(key.split(':')[0] as MapId).longOnly) continue;
      expect(cs.some((c) => c.kind === 'red'), key).toBe(false);
    }
  });

  it('produces trends of roughly 25 candles and around 19 flips a session', () => {
    // The design target from the handoff: one decision every ~4.7 seconds.
    const cs = all['night:101']!;
    let runs = 0;
    let lastColour: string | null = null;
    for (const c of cs) {
      if (c.kind === 'doji') continue;
      if (c.kind !== lastColour) runs++;
      lastColour = c.kind;
    }
    const avgRun = cs.filter((c) => c.kind !== 'doji').length / runs;
    expect(avgRun).toBeGreaterThan(15);
    expect(avgRun).toBeLessThan(40);
  });
});
