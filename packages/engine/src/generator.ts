import {
  C,
  CULL_BEHIND,
  JH,
  LOOKAHEAD,
  MAX_GAP_CHANCE,
  REGIMES,
  VIEW,
  levelGapMul,
  levelRunMul,
  type CandleKind,
  type CharDef,
  type MapDef,
  type RegimeId,
} from './config.js';
import { Random } from './rng.js';
import { clamp, lerp } from './util.js';
import type { Candle, Pip, Power } from './types.js';

/**
 * The chart.
 *
 * A world is a pure function of (seed, map, char) right up until a revive, which
 * splices a doji runway in at the player's death position — after that it is a
 * function of the input tape as well. Nothing here reads player state otherwise, so
 * generation order does not depend on how the run is going, and `LOOKAHEAD` can be
 * widened without perturbing the sequence.
 *
 * Every draw in this file is seeded. Cosmetic randomness (wick length, bob phase,
 * particles) is deliberately absent — the renderer derives those from the stable
 * `i` index so they can never consume from this stream.
 */
export class World {
  candles: Candle[] = [];
  pips: Pip[] = [];
  powers: Power[] = [];
  last: Candle | null = null;
  rng: Random;

  genN = 0;
  runLeft = 0;
  runColor: Exclude<CandleKind, 'doji'> = 'green';
  pendDoji = 0;
  noGap = 0;
  sinceRest = 0;
  sincePower = 0;
  regime: RegimeId = 'drift';
  regimeLeft = 0;
  /** Current level. Scales gap frequency and trend length; see config.ts. */
  level = 1;
  /** Candles of guaranteed-solid doji still owed after a level change. */
  checkpoint = 0;

  private nextIdx = 0;
  private nextPipIdx = 0;
  private nextPowerIdx = 0;

  constructor(
    readonly map: MapDef,
    readonly char: CharDef,
    seed: number,
    private readonly onRegime: (id: RegimeId, name: string) => void = () => {},
  ) {
    this.rng = new Random(seed);
    this.reset();
  }

  reset(): void {
    this.candles = [];
    this.pips = [];
    this.powers = [];
    this.last = null;
    this.genN = 0;
    this.runLeft = 0;
    this.pendDoji = 0;
    this.noGap = 0;
    this.sinceRest = 0;
    this.sincePower = 0;
    this.runColor = this.char.id === 'bear' && !this.map.longOnly ? 'red' : 'green';
    this.regime = 'drift';
    this.regimeLeft = 40;
    for (let i = 0; i < 8; i++) this.push(i * C.pitch, VIEW.h * 0.55, 'doji', 44);
    this.ensure(0);
  }

  push(x: number, top: number, kind: CandleKind, bodyH: number, gapped = false, bridgeStart = false): Candle {
    const c: Candle = { i: this.nextIdx++, x, y: top, w: C.cw, kind, bodyH, scored: false, gapped, bridgeStart };
    this.candles.push(c);
    this.last = c;
    return c;
  }

  byIndex(i: number): Candle | null {
    if (i < 0) return null;
    for (const c of this.candles) if (c.i === i) return c;
    return null;
  }

  private pickRegime(): void {
    const chop = this.map.chop ?? 0;
    const r = this.rng.next();
    let k: RegimeId = r < 0.44 ? 'drift' : r < 0.66 ? 'breakout' : r < 0.88 ? 'selloff' : 'chop';
    // Both of the following draws are ordered exactly as the prototype: the first is
    // unconditional, the second short-circuits. Reordering them changes every chart.
    if (this.rng.next() < chop * 0.18) k = 'chop';
    if (this.map.bias === 'red' && k === 'breakout' && this.rng.next() < 0.6) k = 'selloff';
    this.regime = k;
    this.regimeLeft = this.rng.int(50, 86);
    if (this.genN > C.warm) this.onRegime(k, REGIMES[k].n);
  }

  private dropPips(x: number, y: number): void {
    const n = this.rng.int(2, this.map.rich ? 5 : 4);
    for (let i = 0; i < n; i++) {
      this.pips.push({ i: this.nextPipIdx++, x: x + 8 + i * 22, y: y - this.rng.range(34, 60), got: false });
    }
  }

  private arcPips(a: Candle, b: Candle): void {
    const n = this.rng.int(4, 6);
    const x0 = a.x + a.w;
    const x1 = b.x;
    const top = Math.min(a.y, b.y) - 68;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = lerp(x0, x1, t);
      this.pips.push({
        i: this.nextPipIdx++,
        x,
        y: lerp(lerp(a.y, b.y, t), top, Math.sin(Math.PI * t)) - 20,
        got: false,
      });
    }
  }

  private spawnPower(x: number, y: number): void {
    const r = this.rng.next();
    this.powers.push({
      i: this.nextPowerIdx++,
      x: x + C.cw / 2,
      y,
      kind: r < 0.4 ? 'lev' : r < 0.72 ? 'shield' : 'bull',
      got: false,
    });
  }

  /** Generate forward to the horizon and cull what is safely behind the camera. */
  ensure(cam: number): void {
    const lim = cam + LOOKAHEAD;
    const M = this.map;
    const rng = this.rng;

    while (!this.last || this.last.x < lim) {
      const prev = this.last;
      if (!prev) {
        this.push(0, VIEW.h * 0.55, 'doji', 44);
        continue;
      }
      this.genN++;
      this.sinceRest++;
      this.sincePower++;

      // Warm-up: 26 all-doji candles so the player is never asked to read the tape cold.
      if (this.genN < C.warm) {
        const ny = clamp(prev.y + rng.range(-8, 8), VIEW.h * 0.44, VIEW.h * 0.66);
        this.push(prev.x + C.pitch, ny, 'doji', lerp(prev.bodyH, 44, 0.4));
        if (this.genN > 12 && this.genN % 4 === 0) this.dropPips(prev.x + C.pitch, ny);
        continue;
      }

      const ramp = clamp((this.genN - C.warm) / 40, 0, 1);
      if (--this.regimeLeft <= 0) this.pickRegime();
      const R = REGIMES[this.regime];

      // Breather: two flat doji, a place to breathe and bank pips.
      if (this.sinceRest > rng.int(16, 26)) {
        this.sinceRest = 0;
        let nx = prev.x + C.pitch;
        const ny = prev.y;
        for (let i = 0; i < 2; i++) {
          this.push(nx, ny, 'doji', 46);
          nx += C.pitch;
        }
        this.dropPips(nx - C.pitch, ny);
        continue;
      }

      let kind: CandleKind;
      let bridgeStart = false;
      if (this.checkpoint > 0) {
        // Safe ground for the first few candles of a new level, so the step up in speed
        // is something the player sees coming rather than something they land in.
        this.checkpoint--;
        kind = 'doji';
      } else if (M.longOnly) {
        // Tier 1 — nothing is ever a hole.
        kind = rng.next() < 0.22 ? 'doji' : 'green';
      } else if (this.pendDoji > 0) {
        this.pendDoji--;
        kind = 'doji';
      } else if (this.runLeft <= 0) {
        this.runColor = (R.force as Exclude<CandleKind, 'doji'> | undefined) ?? (this.runColor === 'green' ? 'red' : 'green');
        if (!R.force && rng.next() < 0.2) this.runColor = this.runColor === 'green' ? 'red' : 'green';
        // Shorter trends at higher levels: more forced flips per minute. The draw itself
        // is unchanged so the RNG stream stays aligned with the rest of generation.
        const runScale = levelRunMul(this.level);
        this.runLeft = Math.max(4, Math.round(rng.int(R.run[0], R.run[1]) * runScale));
        this.pendDoji = rng.int(2, 3); // a wide bridge to flip on: 3–4 doji including this one
        kind = 'doji';
        bridgeStart = true;
        this.noGap = 5;
      } else {
        this.runLeft--;
        kind = this.runColor;
      }

      let nx = prev.x + C.pitch;
      let gp = 0;
      if (this.noGap > 0) this.noGap--;
      else if (kind !== 'doji' && rng.next() < Math.min(MAX_GAP_CHANCE, R.gap * ramp * levelGapMul(this.level))) {
        gp = 1;
        nx += C.pitch;
      }

      let dy = kind === 'doji' ? rng.range(-15, 15) : rng.range(R.slope[0], R.slope[1]);
      dy += (VIEW.h * 0.5 - prev.y) * 0.07;
      if (gp > 0) dy = Math.min(dy, 24);
      let ny = clamp(prev.y + dy, VIEW.h * 0.22, VIEW.h * 0.76);
      if (prev.y - ny > JH - 34) ny = prev.y - (JH - 34);
      const rise = prev.y - ny;
      // Snap out of the ambiguous band: a rise is either a walkable step or an obvious jump.
      if (rise > 6 && rise < 46) ny = prev.y - 14;

      const bh = kind === 'doji' ? rng.range(30, 44) : rng.range(38, 44 + ramp * 48);
      const c = this.push(nx, ny, kind, bh, gp > 0, bridgeStart);
      if (gp > 0) this.arcPips(prev, c);
      else if (rng.next() < (M.rich ? 0.3 : 0.18)) this.dropPips(nx, ny);
      if (this.sincePower > rng.int(28, 44)) {
        this.sincePower = 0;
        this.spawnPower(nx, ny - rng.range(60, 98));
      }
    }

    const back = cam - CULL_BEHIND;
    while (this.candles.length && this.candles[0]!.x + this.candles[0]!.w < back) this.candles.shift();
    this.pips = this.pips.filter((p) => p.x > back && !p.got);
    this.powers = this.powers.filter((p) => p.x > back && !p.got);
  }

  /**
   * Begin a new level.
   *
   * Everything past the player is discarded and regenerated, because the horizon is about
   * 38 candles deep — without this the first five seconds of a new level would still be
   * built from the previous level's difficulty, and the step up would arrive late and
   * unexplained. A short doji checkpoint bridges the two.
   */
  startLevel(level: number, playerX: number, cam: number): void {
    this.level = level;
    const keepTo = playerX + C.pitch * 3;
    this.candles = this.candles.filter((c) => c.x <= keepTo);
    this.pips = this.pips.filter((p) => p.x <= keepTo);
    this.powers = this.powers.filter((p) => p.x <= keepTo);
    this.last = this.candles[this.candles.length - 1] ?? null;
    this.checkpoint = 5;
    // Let the new level open on a fresh trend rather than half of the old one.
    this.runLeft = 0;
    this.pendDoji = 0;
    this.noGap = 0;
    this.ensure(cam);
  }

  /**
   * Splice a fresh doji runway in at the camera and drop everything the player was
   * about to fall through. Ported from `revive()`; mutates the world, so a session
   * that revives is only reproducible together with its input tape.
   */
  spliceReviveRunway(cam: number): number {
    const sx = cam + VIEW.w * C.px - C.pitch * 2;
    this.candles = this.candles.filter((c) => c.x < sx - C.pitch);
    this.pips = this.pips.filter((p) => p.x < sx - C.pitch);
    this.powers = this.powers.filter((p) => p.x < sx - C.pitch);
    this.last = this.candles[this.candles.length - 1] ?? null;
    const y = VIEW.h * 0.55;
    let x = sx;
    for (let i = 0; i < 10; i++) {
      this.push(x, y, 'doji', 46);
      x += C.pitch;
    }
    this.ensure(cam);
    return sx;
  }
}

/**
 * Your footing is never pulled out from under you — flipping only changes the tape
 * ahead. Removing the `standIdx` clause makes flipping while grounded instant death.
 */
export function isSolid(c: Candle, short: boolean, standIdx: number): boolean {
  if (c.kind === 'doji') return true;
  if (c.i === standIdx) return true;
  return short ? c.kind === 'red' : c.kind === 'green';
}

/**
 * Which doji bridges the player actually has to act on. Pure derivation from world +
 * player state, so the renderer calls it directly and the sim never has to.
 */
export function computeWarnings(
  candles: readonly Candle[],
  longOnly: boolean,
  short: boolean,
  standIdx: number,
  playerX: number,
): Set<number> {
  const out = new Set<number>();
  if (longOnly) return out;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (c.kind !== 'doji' || c.x < playerX - 20) continue;
    let nxt: Candle | null = null;
    for (let j = i + 1; j < candles.length; j++) {
      if (candles[j]!.kind !== 'doji') {
        nxt = candles[j]!;
        break;
      }
    }
    if (nxt && !isSolid(nxt, short, standIdx)) out.add(c.i);
  }
  return out;
}
