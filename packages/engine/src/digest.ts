import type { Sim } from './sim.js';

/**
 * Final-state fingerprint.
 *
 * The point is not cryptographic strength, it is bisection: if a browser tape and a
 * server replay disagree, the digest says so immediately and cheaply, and the per-field
 * feed below says which field drifted. Floats go in as their exact IEEE-754 bytes, so a
 * one-ulp divergence is caught rather than rounded away.
 */
class Feed {
  private h1 = 0x811c9dc5;
  private h2 = 0x01000193;
  private buf = new DataView(new ArrayBuffer(8));

  byte(b: number): void {
    this.h1 = Math.imul(this.h1 ^ (b & 0xff), 0x01000193) >>> 0;
    this.h2 = Math.imul(this.h2 ^ (b & 0xff), 0x85ebca6b) >>> 0;
    this.h2 = ((this.h2 << 13) | (this.h2 >>> 19)) >>> 0;
  }

  num(v: number): this {
    this.buf.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) this.byte(this.buf.getUint8(i));
    return this;
  }

  int(v: number): this {
    this.buf.setInt32(0, v | 0, true);
    for (let i = 0; i < 4; i++) this.byte(this.buf.getUint8(i));
    return this;
  }

  bool(v: boolean): this {
    this.byte(v ? 1 : 0);
    return this;
  }

  str(v: string): this {
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      this.byte(c & 0xff);
      this.byte(c >>> 8);
    }
    this.byte(0);
    return this;
  }

  hex(): string {
    return (this.h1 >>> 0).toString(16).padStart(8, '0') + (this.h2 >>> 0).toString(16).padStart(8, '0');
  }
}

/** Every field that could differ between two runs that were supposed to be identical. */
export function digest(sim: Sim): string {
  const f = new Feed();
  const p = sim.p;
  const w = sim.world;
  f.int(sim.frame)
    .str(sim.mode)
    .str(sim.endReason ?? '-')
    .num(sim.t)
    .num(sim.cam)
    .num(sim.spd)
    .num(sim.left)
    .int(sim.level)
    .num(sim.breakLeft)
    .num(sim.reviveLeft)
    .num(sim.pnl)
    .int(sim.pips)
    .int(sim.streak)
    .int(sim.mult)
    .int(sim.bestMult)
    .int(sim.cleared)
    .int(sim.flips)
    .int(sim.cleanFlips)
    .int(sim.perfect)
    .int(sim.perfectRun)
    .num(sim.slow)
    .num(sim.stCd)
    .num(sim.inv)
    .bool(sim.belled)
    .bool(sim.usedRevive)
    .num(sim.reviveLeft);
  f.num(p.x).num(p.y).num(p.vy).bool(p.ground).int(p.jumps).num(p.coy).num(p.buf).bool(p.short)
    .num(p.flipCd).bool(p.alive).int(p.standIdx).int(p.lastLandIdx);
  f.num(sim.buffs.lev).num(sim.buffs.bull).bool(sim.buffs.shield);
  f.int(w.rng.getState())
    .int(w.genN)
    .int(w.runLeft)
    .str(w.runColor)
    .int(w.pendDoji)
    .int(w.noGap)
    .int(w.sinceRest)
    .int(w.sincePower)
    .str(w.regime)
    .int(w.regimeLeft)
    .int(w.candles.length)
    .int(w.pips.length)
    .int(w.powers.length);
  for (const c of w.candles) f.int(c.i).num(c.x).num(c.y).str(c.kind).num(c.bodyH).bool(c.scored);
  for (const pip of w.pips) f.int(pip.i).num(pip.x).num(pip.y).bool(pip.got);
  for (const pw of w.powers) f.int(pw.i).num(pw.x).num(pw.y).str(pw.kind).bool(pw.got);
  return f.hex();
}
