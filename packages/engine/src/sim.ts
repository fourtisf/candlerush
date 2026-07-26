import {
  C,
  ENGINE_VERSION,
  MAX_FRAMES,
  REVIVE_FRAMES,
  REVIVE_MIN_CLEARED,
  REVIVE_SECONDS,
  STEP,
  VIEW,
  charById,
  mapById,
  type CharDef,
  type MapDef,
} from './config.js';
import { World, isSolid } from './generator.js';
import { createPlayer, findFlipTarget, findLanding, findRecovery } from './player.js';
import { clamp, lerp } from './util.js';
import {
  IN,
  type Buffs,
  type Candle,
  type EndReason,
  type InputCode,
  type PlayerState,
  type SessionConfig,
  type SimEvent,
  type SimMode,
  type SimSnapshot,
} from './types.js';

/**
 * The game.
 *
 * Pure: no DOM, no `window`, no `performance`, no `Date`, no `Math.random`. `step()`
 * advances exactly one fixed frame and takes no wall-clock time as an argument, ever.
 * That is what lets the server run the identical thing and compute the score itself.
 *
 * Rendering reads `snapshot()` and drains `events`. It must never write back — the
 * snapshot is typed readonly for exactly that reason.
 */
export class Sim {
  readonly cfg: SessionConfig;
  readonly char: CharDef;
  readonly map: MapDef;
  readonly world: World;

  mode: SimMode = 'running';
  endReason: EndReason | null = null;
  frame = 0;

  /** Simulated seconds since session start. Derived from frames, never from a clock. */
  t = 0;
  cam = 0;
  spd = 0;
  left: number = C.session;
  pnl = 0;
  pips = 0;
  streak = 0;
  mult = 1;
  bestMult = 1;
  cleared = 0;
  flips = 0;
  cleanFlips = 0;
  perfect = 0;
  perfectRun = 0;
  dayP = 0;
  slow = 1;
  /** Stumble cooldown. */
  stCd = 0;
  /** Invulnerability: no stumbles for this long after a start or a revive. */
  inv = 0;
  belled = false;
  usedRevive = false;
  reviveLeft = 0;

  readonly p: PlayerState = createPlayer();
  readonly buffs: Buffs = { lev: 0, bull: 0, shield: false };

  /**
   * Drained by the renderer for audio, particles and toasts.
   *
   * Off by default: a server replay has nobody to draw for, and 5,400 frames of
   * unread events is just garbage to collect. Events never feed back into the sim,
   * so a run with them off is bit-identical to a run with them on.
   */
  events: SimEvent[] = [];
  private collectEvents: boolean;

  constructor(cfg: SessionConfig, opts: { mode?: SimMode; events?: boolean } = {}) {
    if (cfg.engineVersion !== ENGINE_VERSION) {
      throw new Error(`engine version mismatch: session ${cfg.engineVersion}, engine ${ENGINE_VERSION}`);
    }
    this.cfg = cfg;
    this.collectEvents = opts.events ?? false;
    this.char = charById(cfg.charId);
    this.map = mapById(cfg.mapId);
    this.world = new World(this.map, this.char, cfg.seed, (id, name) => this.emit({ t: 'regime', id, name }));
    this.mode = opts.mode ?? 'running';

    this.spd = C.spd0 * this.map.spd;
    this.inv = 1.4;
    this.p.short = this.char.id === 'bear' && !this.map.longOnly;
    this.buffs.shield = this.char.id === 'gem';

    const start = this.world.candles[3]!;
    this.p.x = start.x;
    this.p.y = start.y - C.ph;
    this.p.ground = true;
    this.p.standIdx = start.i;
    this.cam = this.p.x - VIEW.w * C.px;
  }

  /* ── inputs ──────────────────────────────────────────────────────────────── */

  /**
   * Apply one tape entry. Always called at the head of the frame it is stamped for, so
   * a press lands on the same frame in the browser and on the server.
   */
  applyInput(code: InputCode | number): void {
    switch (code) {
      case IN.JUMP_DOWN:
        if (this.mode === 'running') this.p.buf = C.buffer;
        break;
      case IN.JUMP_UP:
        // Jump cut. Unconditional in the prototype, including mid-flight after a death.
        if (this.p.vy < 0) this.p.vy *= C.cut;
        break;
      case IN.FLIP:
        this.flip();
        break;
      case IN.REVIVE:
        if (this.mode === 'reviveOffer') this.revive();
        break;
      case IN.DECLINE:
        if (this.mode === 'reviveOffer') this.end('declined');
        break;
      default:
        break;
    }
  }

  private flip(): void {
    if (this.map.longOnly || this.p.flipCd > 0 || this.mode !== 'running') return;
    this.p.flipCd = 0.24;
    this.p.short = !this.p.short;
    this.flips++;
    const ahead = findFlipTarget(this.world.candles, this.p.x);
    let clean = false;
    if (ahead && (this.p.short ? ahead.kind === 'red' : ahead.kind === 'green')) {
      clean = true;
      this.cleanFlips++;
      this.pnl += 250 * this.mult;
    }
    this.emit({
      t: 'flip',
      short: this.p.short,
      clean,
      x: this.p.x + C.pw / 2,
      y: this.p.y + C.ph / 2,
    });
  }

  /** Whether a liquidation right now would offer the player a top-up. */
  get canRevive(): boolean {
    return !this.usedRevive && this.cleared >= REVIVE_MIN_CLEARED;
  }

  private revive(): void {
    this.usedRevive = true;
    const sx = this.world.spliceReviveRunway(this.cam);
    const y = VIEW.h * 0.55;
    this.p.x = sx + C.pitch * 2;
    this.p.y = y - C.ph;
    this.p.vy = 0;
    this.p.ground = true;
    this.p.jumps = 0;
    this.p.alive = true;
    this.p.lastLandIdx = -1;
    this.p.standIdx = -1;
    this.mode = 'running';
    this.streak = 0;
    this.mult = 1;
    this.perfectRun = 0;
    this.spd = Math.max(C.spd0, this.spd * 0.8);
    this.slow = 1;
    this.inv = 2.4;
    this.buffs.shield = true;
    this.emit({ t: 'revive' });
  }

  private end(reason: EndReason): void {
    if (this.mode === 'ended') return;
    this.mode = 'ended';
    this.endReason = reason;
    this.emit({ t: 'end', reason });
  }

  private die(): void {
    this.p.alive = false;
    this.emit({ t: 'death', x: this.p.x + C.pw / 2, y: this.p.y + C.ph / 2 });
    if (this.canRevive) {
      this.mode = 'reviveOffer';
      this.reviveLeft = REVIVE_SECONDS;
      this.emit({ t: 'reviveOffer' });
      return;
    }
    this.end('liquidated');
  }

  /* ── derived ─────────────────────────────────────────────────────────────── */

  private get bellMul(): number {
    return this.belled ? 2 : 1;
  }

  /** Difficulty scalar, dampened by the player's persisted handicap. */
  private get diff(): number {
    return clamp((this.spd - C.spd0) / (C.spdMax - C.spd0), 0, 1) * (1 - this.cfg.handicap * 0.55);
  }

  /* ── the frame ───────────────────────────────────────────────────────────── */

  private emit(e: SimEvent): void {
    if (this.collectEvents) this.events.push(e);
  }

  /** Take everything raised since the last drain. Renderer-only; never read by the sim. */
  drainEvents(): SimEvent[] {
    if (!this.events.length) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Advance exactly one fixed step. */
  step(): void {
    this.advance();
    this.frame++;
  }

  private advance(): void {
    const dt = STEP;
    if (this.mode === 'ended') return;
    this.t += dt;

    // Menus scroll the tape by at a fixed crawl; so does the revive offer, exactly as in
    // the prototype — the session clock freezes but the camera keeps drifting, and the
    // runway a revive splices in depends on where it drifted to.
    if (this.mode === 'attract') {
      this.cam += 62 * dt;
      this.world.ensure(this.cam);
      return;
    }
    if (this.mode === 'reviveOffer') {
      this.cam += 62 * dt;
      this.world.ensure(this.cam);
      this.reviveLeft -= dt;
      if (this.reviveLeft <= 0) this.end('declined');
      return;
    }

    this.left -= dt;
    if (!this.belled && this.left <= C.bell) {
      this.belled = true;
      this.emit({ t: 'bell' });
    }
    if (this.left <= 0) {
      this.left = 0;
      this.end('bell');
      return;
    }

    const p = this.p;
    const buffs = this.buffs;
    const world = this.world;

    this.stCd = Math.max(0, this.stCd - dt);
    this.inv = Math.max(0, this.inv - dt);
    p.flipCd = Math.max(0, p.flipCd - dt);
    this.slow = lerp(this.slow, 1, 1 - Math.pow(0.05, dt));

    const fox = this.char.id === 'fox' ? 0.7 : 1;
    this.spd = Math.min(
      C.spdMax * this.map.spd,
      this.spd + C.ramp * dt * (1 + this.diff) * (1 - this.cfg.handicap * 0.4) * fox,
    );
    const speed = this.spd * this.slow * (this.belled ? 1.12 : 1) * (buffs.bull > 0 ? 1.3 : 1);

    if (buffs.lev > 0) buffs.lev = Math.max(0, buffs.lev - dt);
    if (buffs.bull > 0) {
      buffs.bull = Math.max(0, buffs.bull - dt);
      if (!buffs.bull) p.vy = 0;
    }

    p.x += speed * dt;
    world.ensure(this.cam);

    const prevFeet = p.y + C.ph;
    const maxJ = this.char.id === 'ape' ? 3 : 2;

    if (buffs.bull > 0) {
      // Momentum — fly above the tape.
      let tgt = VIEW.h * 0.34;
      for (const c of world.candles) {
        if (c.x > p.x - 40 && c.x < p.x + 260 && isSolid(c, p.short, p.standIdx)) {
          tgt = Math.min(tgt, c.y - 110);
        }
      }
      p.y = lerp(p.y, clamp(tgt, VIEW.h * 0.1, VIEW.h * 0.6), 1 - Math.pow(0.0005, dt));
      p.vy = 0;
      p.ground = false;
      p.jumps = 0;
      p.standIdx = -1;
    } else {
      p.buf = Math.max(0, p.buf - dt);
      p.coy = p.ground ? C.coyote : Math.max(0, p.coy - dt);
      if (p.buf > 0 && (p.coy > 0 || p.jumps < maxJ)) {
        const first = p.coy > 0 && p.jumps === 0;
        p.vy = -C.jumpV * (first ? 1 : 0.92);
        p.jumps = first ? 1 : p.jumps + 1;
        p.buf = 0;
        p.coy = 0;
        p.ground = false;
        p.standIdx = -1;
        this.emit({ t: 'jump', first, x: p.x + C.pw / 2, y: p.y + C.ph });
      }
      p.vy += C.grav * dt;
      p.y += p.vy * dt;
      p.ground = false;

      const feet = p.y + C.ph;
      const land = findLanding(world.candles, p, prevFeet, feet);
      if (land) {
        p.y = land.y - C.ph;
        p.vy = 0;
        p.ground = true;
        p.jumps = 0;
        p.standIdx = land.i;
        this.onLand(land);
      } else if (!p.ground) {
        p.lastLandIdx = -1;
        p.standIdx = -1;
      }

      // Horizontal contact. Mutates `standIdx` mid-loop, which changes solidity for the
      // candles it has yet to visit, and reuses the pre-step-up `ft`. Both are faithful
      // to the prototype; both are load-bearing for how a staircase resolves.
      const ft = p.y + C.ph;
      for (const c of world.candles) {
        if (!isSolid(c, p.short, p.standIdx) || c === land) continue;
        if (p.x + C.pw <= c.x + 2 || p.x >= c.x + c.w - 2) continue;
        const dep = ft - c.y;
        if (dep <= 4) continue;
        if (dep <= C.step && p.vy >= -60) {
          p.y = c.y - C.ph;
          p.vy = 0;
          p.ground = true;
          p.jumps = 0;
          p.standIdx = c.i;
          this.onLand(c);
        } else if (dep > C.step && p.vy > -120) {
          this.stumble(c, dep);
          break;
        }
      }
    }

    // Off the chart.
    if (p.y > VIEW.h + 120) {
      if (buffs.shield) {
        buffs.shield = false;
        const c = findRecovery(world.candles, p);
        if (c) {
          p.y = c.y - C.ph - 120;
          p.x = c.x + 4;
        }
        p.vy = -200;
        this.inv = 1.2;
        this.emit({ t: 'shield', x: p.x + C.pw / 2, y: p.y + C.ph / 2 });
      } else {
        this.die();
        return;
      }
    }

    // Pickups.
    const mag = this.char.id === 'whale' ? C.magnet * 2 : C.magnet;
    const pv = this.char.id === 'whale' ? 78 : 60;
    for (const pip of world.pips) {
      if (pip.got) continue;
      const dx = p.x + C.pw / 2 - pip.x;
      const dy = p.y + C.ph / 2 - pip.y;
      const rr = buffs.bull > 0 ? 130 : mag;
      if (dx * dx + dy * dy < rr * rr) {
        pip.got = true;
        this.pips++;
        this.pnl += pv * this.mult * this.bellMul;
        this.emit({ t: 'pip', x: pip.x, y: pip.y, n: this.pips });
      }
    }
    for (const pw of world.powers) {
      if (pw.got) continue;
      const dx = p.x + C.pw / 2 - pw.x;
      const dy = p.y + C.ph / 2 - pw.y;
      if (dx * dx + dy * dy < 40 * 40) {
        pw.got = true;
        if (pw.kind === 'lev') buffs.lev = 10;
        if (pw.kind === 'shield') buffs.shield = true;
        if (pw.kind === 'bull') {
          buffs.bull = 4.5;
          p.jumps = 0;
        }
        this.emit({ t: 'power', kind: pw.kind, x: pw.x, y: pw.y });
      }
    }

    this.pnl +=
      dt * speed * 0.075 * this.mult * (buffs.lev > 0 ? 2 : 1) * this.bellMul * this.map.pay;
    this.dayP = clamp(1 - this.left / C.session, 0, 1);
    this.cam = lerp(this.cam, p.x - VIEW.w * C.px, 1 - Math.pow(0.00002, dt));
  }

  private stumble(c: Candle, dep: number): void {
    if (this.stCd > 0 || this.inv > 0) return;
    const p = this.p;
    this.stCd = 0.6;
    p.x = c.x - C.pw - 1;
    p.vy = -Math.min(C.jumpV, Math.sqrt(2 * C.grav * (dep + 18)));
    p.jumps = 1;
    p.ground = false;
    p.lastLandIdx = -1;
    p.standIdx = -1;
    this.slow = 0.7;
    const m = Math.max(1, Math.floor(this.mult / 2));
    this.emit({ t: 'stumble', x: p.x + C.pw, y: p.y + C.ph / 2, mult: this.mult });
    this.mult = m;
    this.streak = (m - 1) * 3;
    this.perfectRun = 0;
  }

  private onLand(c: Candle): void {
    const p = this.p;
    if (p.lastLandIdx === c.i) return;
    p.lastLandIdx = c.i;
    if (!c.scored) {
      c.scored = true;
      this.cleared++;
    }
    const edge = p.x - c.x;
    const perfect = edge > -6 && edge < 18;
    if (perfect) {
      this.perfect++;
      this.perfectRun++;
      this.pnl += 150 * this.mult * this.bellMul;
      this.pips++;
    } else {
      this.perfectRun = 0;
    }
    this.emit({
      t: 'land',
      x: p.x + C.pw / 2,
      y: p.y + C.ph,
      kind: c.kind,
      perfect,
      perfectRun: this.perfectRun,
    });
    this.streak++;
    const m = clamp(1 + Math.floor(this.streak / 3), 1, 10);
    if (m > this.mult) {
      this.mult = m;
      this.bestMult = Math.max(this.bestMult, m);
      this.emit({ t: 'streak', mult: m });
    }
  }

  /* ── output ──────────────────────────────────────────────────────────────── */

  /** Gross session P&L, rounded and floored at zero. The number that becomes money. */
  get score(): number {
    return Math.max(0, Math.round(this.pnl));
  }

  /**
   * Read-only view for the renderer. Arrays are live references for cost reasons; the
   * `Deep`-readonly typing on the consumer side is what keeps the renderer honest.
   */
  snapshot(): SimSnapshot {
    return {
      frame: this.frame,
      mode: this.mode,
      endReason: this.endReason,
      t: this.t,
      cam: this.cam,
      spd: this.spd,
      left: this.left,
      pnl: this.pnl,
      pips: this.pips,
      mult: this.mult,
      bestMult: this.bestMult,
      streak: this.streak,
      perfect: this.perfect,
      perfectRun: this.perfectRun,
      cleared: this.cleared,
      flips: this.flips,
      cleanFlips: this.cleanFlips,
      belled: this.belled,
      dayP: this.dayP,
      slow: this.slow,
      inv: this.inv,
      regime: this.world.regime,
      usedRevive: this.usedRevive,
      reviveLeft: this.reviveLeft,
      player: this.p,
      buffs: this.buffs,
      candles: this.world.candles,
      pipsList: this.world.pips,
      powers: this.world.powers,
    };
  }
}

export { MAX_FRAMES, REVIVE_FRAMES, STEP };
