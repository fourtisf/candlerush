import {
  C,
  VIEW,
  computeWarnings,
  isSolid,
  type CandleKind,
  type CharDef,
  type MapDef,
  type SimEvent,
  type SimSnapshot,
} from '@candle-rush/engine';
import { drawChar, mix, rgb, rgba } from './sprites';

/**
 * Everything that draws.
 *
 * The renderer reads the simulation and never writes to it. All of the randomness in
 * this file is cosmetic — particles, weather, the star field, wick lengths, bob phases —
 * and deliberately unseeded: none of it can move a score, and keeping it out of the
 * engine's RNG stream is what lets the server replay a run without drawing anything.
 *
 * Interpolation is for the eye only. Positions are lerped between the last two fixed
 * steps so 60Hz logic looks smooth on a 144Hz display; the simulation never sees it.
 */

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const COL: Record<CandleKind, number[]> = {
  green: [34, 230, 160],
  red: [255, 74, 107],
  doji: [255, 206, 92],
};
const XS = [
  [52, 6, 26],
  [96, 14, 40],
  [150, 28, 52],
  [214, 60, 70],
];

/**
 * Stable per-object cosmetics without per-object state.
 *
 * The prototype stored a random `wick` on every candle and a random `ph` on every pip.
 * Those were draws from the same stream as the world, so they had to come out; deriving
 * them from the object's index instead keeps them stable frame to frame and keeps the
 * engine's RNG reserved for things that matter.
 */
function hash01(i: number, salt: number): number {
  let x = Math.imul(i ^ salt, 0x27d4eb2d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  l: number;
  m: number;
  c: number[];
  r: number;
  g: number;
}

interface Amb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  c: number[];
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number;
}

interface Building {
  x: number;
  w: number;
  h: number;
  lit: boolean[];
}

interface Peak {
  x: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

export interface RenderExtras {
  hint: 0 | 1 | 2 | 3;
  paused: boolean;
  /** Seconds of simulated time, used for idle animation phases. */
  t: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private map: MapDef;
  private char: CharDef;

  /** Real canvas size in CSS pixels. */
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Virtual-space rectangle actually visible, once the fixed 1280x720 band is letterboxed. */
  private view: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: VIEW.w, h: VIEW.h };
  private scale = 1;

  private stars: Star[] = [];
  private buildings: Building[] = [];
  private peaks: Peak[] = [];
  private ridge: Point[] = [];
  private amb: Amb[] = [];
  private parts: Particle[] = [];

  private ghost = new Map<number, number>();
  private trail: Point[] = [];
  private prev: { x: number; y: number; cam: number } | null = null;

  private shake = 0;
  private flash = 0;
  private deathFlash = 0;
  private sq = 1;
  private rot = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    map: MapDef,
    char: CharDef,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    this.ctx = ctx;
    this.map = map;
    this.char = char;
    this.resize();
  }

  setMap(map: MapDef): void {
    this.map = map;
    this.buildBackground();
  }

  setChar(char: CharDef): void {
    this.char = char;
  }

  /** Drop everything that belongs to the previous run. */
  reset(): void {
    this.parts = [];
    this.ghost.clear();
    this.trail = [];
    this.prev = null;
    this.shake = 0;
    this.flash = 0;
    this.deathFlash = 0;
    this.sq = 1;
    this.rot = 0;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);

    // Contain: the whole 1280x720 band is always on screen, and whatever is left over
    // becomes extra sky rather than extra tape. Showing more world on a wider monitor
    // would be a real advantage, so the visible world is fixed and only the sky stretches.
    this.scale = Math.min(this.w / VIEW.w, this.h / VIEW.h);
    const visW = this.w / this.scale;
    const visH = this.h / this.scale;
    this.view = { x: -(visW - VIEW.w) / 2, y: -(visH - VIEW.h) / 2, w: visW, h: visH };
    this.buildBackground();
  }

  private buildBackground(): void {
    const v = this.view;
    this.stars = [];
    const n = Math.round((v.w * v.h) / 13000);
    for (let i = 0; i < n; i++) {
      this.stars.push({
        x: Math.random() * v.w * 1.4,
        y: v.y + Math.random() * v.h * 0.64,
        r: Math.random() * 1.2 + 0.3,
        a: Math.random() * 0.7 + 0.25,
        tw: Math.random() * 6,
      });
    }
    this.buildings = [];
    this.peaks = [];
    this.ridge = [];
    if (this.map.bg === 'city') {
      let x = 0;
      while (x < 8000) {
        const w = rnd(34, 78);
        const h = rnd(70, 260);
        this.buildings.push({
          x,
          w,
          h,
          lit: Array.from({ length: Math.floor(h / 26) }, () => Math.random() < 0.45),
        });
        x += w + rnd(6, 20);
      }
    } else if (this.map.bg === 'peaks') {
      let x = 0;
      while (x < 8000) {
        const w = rnd(120, 260);
        this.peaks.push({ x, w, h: rnd(120, 300) });
        x += w * 0.62;
      }
    } else if (this.map.bg === 'dunes') {
      for (let i = 0; i < 220; i++) {
        this.ridge.push({ x: i * 38, y: VIEW.h * 0.62 + Math.sin(i * 0.18) * 46 + Math.sin(i * 0.07) * 70 });
      }
    } else {
      for (let i = 0; i < 220; i++) {
        this.ridge.push({ x: i * 38, y: VIEW.h * 0.6 + Math.sin(i * 0.11) * 54 + Math.sin(i * 0.31) * 18 });
      }
    }
    this.amb = [];
    if (this.map.amb) for (let i = 0; i < 46; i++) this.amb.push(this.newAmb(true));
  }

  private newAmb(init: boolean): Amb {
    const v = this.view;
    const k = this.map.amb;
    const x = v.x + Math.random() * v.w;
    if (k === 'spark') {
      return {
        x,
        y: init ? v.y + Math.random() * v.h : v.y + v.h + 8,
        vx: rnd(-8, 8),
        vy: rnd(-26, -12),
        r: rnd(0.8, 2),
        a: rnd(0.2, 0.6),
        c: [140, 190, 255],
      };
    }
    if (k === 'ash') {
      return {
        x,
        y: init ? v.y + Math.random() * v.h : v.y - 8,
        vx: rnd(-22, -6),
        vy: rnd(16, 42),
        r: rnd(0.9, 2.4),
        a: rnd(0.15, 0.5),
        c: [255, 140, 110],
      };
    }
    return {
      x,
      y: init ? v.y + Math.random() * v.h : v.y + v.h + 8,
      vx: rnd(-14, 6),
      vy: rnd(-34, -16),
      r: rnd(0.9, 2.6),
      a: rnd(0.2, 0.6),
      c: [255, 214, 120],
    };
  }

  /* ── events → particles, shake, flash ───────────────────────────────────── */

  private burst(x: number, y: number, n: number, col: number[], sp = 200, life = 0.5, g = 900): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      const s = rnd(sp * 0.3, sp);
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - sp * 0.3,
        l: life * rnd(0.6, 1.2),
        m: life,
        c: col,
        r: rnd(1.6, 3.6),
        g,
      });
    }
  }

  /** Turn one frame's simulation events into things to look at. */
  consume(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.t) {
        case 'jump':
          this.sq = 1.35;
          this.burst(e.x, e.y, e.first ? 6 : 10, e.first ? [255, 244, 232] : [255, 206, 92], e.first ? 120 : 180, 0.3);
          break;
        case 'land': {
          this.sq = 0.62;
          this.shake = Math.min(this.shake + 3, 7);
          this.burst(e.x, e.y, 7, COL[e.kind], 130, 0.32);
          if (e.perfect) this.burst(e.x, e.y - C.ph, 12, [255, 206, 92], 230, 0.5, 400);
          break;
        }
        case 'flip':
          this.flash = 0.4;
          this.burst(e.x, e.y, 14, e.short ? [255, 74, 107] : [34, 230, 160], 240, 0.5, 200);
          if (e.clean) this.burst(e.x, e.y, 10, [255, 206, 92], 200, 0.45, 300);
          break;
        case 'pip':
          this.burst(e.x, e.y, 6, [255, 206, 92], 150, 0.35, 300);
          break;
        case 'power': {
          this.flash = 1;
          this.shake = 8;
          const col = e.kind === 'lev' ? [255, 206, 92] : e.kind === 'shield' ? [111, 180, 255] : [34, 230, 160];
          this.burst(e.x, e.y, 22, col, 300, 0.75);
          break;
        }
        case 'stumble':
          this.shake = 14;
          this.flash = 0.5;
          this.burst(e.x, e.y, 12, [255, 74, 107], 200, 0.5);
          break;
        case 'shield':
          this.flash = 1;
          this.shake = 12;
          break;
        case 'bell':
          this.flash = 1;
          break;
        case 'death':
          this.shake = 22;
          this.deathFlash = 1;
          this.burst(e.x, e.y, 34, [255, 74, 107], 420, 0.9, 600);
          break;
        case 'revive':
          this.flash = 1;
          this.deathFlash = 0;
          this.trail = [];
          break;
        case 'end':
          if (e.reason === 'cleared') this.shake = 16;
          break;
        default:
          break;
      }
    }
  }

  /** Cosmetic animation. Runs on real elapsed time; touches nothing the sim reads. */
  update(dt: number, snap: SimSnapshot): void {
    this.shake = Math.max(0, this.shake - dt * 60);
    this.flash = Math.max(0, this.flash - dt * 3.5);
    this.deathFlash = Math.max(0, this.deathFlash - dt * 1.2);

    const k = 1 - Math.pow(0.0006, dt);
    for (const c of snap.candles) {
      const target = isSolid(c, snap.player.short, snap.player.standIdx) ? 0 : 1;
      this.ghost.set(c.i, lerp(this.ghost.get(c.i) ?? target, target, k));
    }

    if (this.map.amb) {
      const v = this.view;
      for (let i = 0; i < this.amb.length; i++) {
        const p = this.amb[i]!;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y < v.y - 20 || p.y > v.y + v.h + 20 || p.x < v.x - 20 || p.x > v.x + v.w + 20) {
          this.amb[i] = this.newAmb(false);
        }
      }
    }

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]!;
      p.l -= dt;
      if (p.l <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    this.sq = lerp(this.sq, 1, 1 - Math.pow(0.001, dt));
    const rotTarget = snap.player.ground ? 0 : clamp(snap.player.vy / 1400, -0.4, 0.5);
    this.rot = lerp(this.rot, rotTarget, 1 - Math.pow(0.0008, dt));

    if (snap.buffs.bull > 0 && Math.random() < dt * 40) {
      this.parts.push({
        x: snap.player.x,
        y: snap.player.y + C.ph / 2,
        vx: -rnd(120, 300),
        vy: rnd(-40, 40),
        l: 0.4,
        m: 0.4,
        c: [34, 230, 160],
        r: rnd(1.5, 3.5),
        g: 0,
      });
    }
  }

  /* ── the frame ──────────────────────────────────────────────────────────── */

  render(snap: SimSnapshot, alpha: number, extras: RenderExtras): void {
    const X = this.ctx;
    const p = snap.player;

    // Interpolate between the last two fixed steps. Eye candy only.
    const px = this.prev ? lerp(this.prev.x, p.x, alpha) : p.x;
    const py = this.prev ? lerp(this.prev.y, p.y, alpha) : p.y;
    const cam = this.prev ? lerp(this.prev.cam, snap.cam, alpha) : snap.cam;
    this.prev = { x: p.x, y: p.y, cam: snap.cam };

    if (snap.mode === 'running') {
      this.trail.unshift({ x: px + C.pw / 2, y: py + C.ph / 2 });
      if (this.trail.length > 14) this.trail.pop();
    }

    X.setTransform(this.scale * this.dpr, 0, 0, this.scale * this.dpr, 0, 0);
    X.translate(-this.view.x, -this.view.y);
    X.save();
    if (this.shake > 0) X.translate(rnd(-this.shake, this.shake), rnd(-this.shake, this.shake));

    this.drawSky(snap, extras.t, cam);
    this.drawBG(cam);

    const warnings =
      snap.mode === 'running'
        ? computeWarnings(snap.candles, !!this.map.longOnly, p.short, p.standIdx, p.x)
        : new Set<number>();
    for (const c of snap.candles) this.drawCandle(c, cam, extras.t, warnings.has(c.i));
    for (const pip of snap.pipsList) if (!pip.got) this.drawPip(pip, cam, extras.t);
    for (const pw of snap.powers) if (!pw.got) this.drawPower(pw, cam, extras.t);
    this.drawParts(cam);
    if (snap.mode === 'running' || extras.paused) {
      this.drawPlayer(snap, px, py, cam, extras.t);
      this.drawHint(extras.hint, px, py, cam, extras.t);
    }

    X.restore();

    if (this.flash > 0) {
      X.fillStyle = `rgba(255,244,232,${this.flash * 0.16})`;
      X.fillRect(this.view.x, this.view.y, this.view.w, this.view.h);
    }
    if (extras.paused) {
      X.fillStyle = 'rgba(6,8,28,.72)';
      X.fillRect(this.view.x, this.view.y, this.view.w, this.view.h);
      X.fillStyle = '#FFF4E8';
      X.textAlign = 'center';
      X.font = '800 38px "Bricolage Grotesque",system-ui,sans-serif';
      X.fillText('PAUSED', VIEW.w / 2, VIEW.h / 2);
      X.font = '400 10px "Martian Mono",monospace';
      X.fillStyle = 'rgba(255,244,232,.5)';
      X.fillText('TAP OR PRESS P TO RESUME', VIEW.w / 2, VIEW.h / 2 + 28);
    }
  }

  private drawSky(snap: SimSnapshot, t: number, cam: number): void {
    const X = this.ctx;
    const v = this.view;
    const day = snap.dayP;
    const d = this.deathFlash;
    const N = this.map.sky[0];
    const D = this.map.sky[1];
    const st = [0, 0.34, 0.62, 0.84];
    const g = X.createLinearGradient(0, v.y, 0, v.y + v.h);
    for (let i = 0; i < 4; i++) {
      let c = mix(N[i]!, D[i]!, day);
      if (d > 0) c = mix(c, XS[i]!, d * 0.85);
      if (snap.belled) c = mix(c, [255, 180, 90], 0.16);
      g.addColorStop(st[i]!, rgb(c));
    }
    let b = mix(N[3]!, D[3]!, day);
    if (d > 0) b = mix(b, XS[3]!, d * 0.85);
    g.addColorStop(1, rgb(mix(b, [10, 8, 26], 0.55)));
    X.fillStyle = g;
    X.fillRect(v.x, v.y, v.w, v.h);

    const sa = (1 - day) * 0.9 * (1 - d);
    if (sa > 0.02) {
      for (const s of this.stars) {
        let x = (s.x - cam * 0.05) % (v.w * 1.4);
        if (x < 0) x += v.w * 1.4;
        X.globalAlpha = sa * s.a * (0.6 + 0.4 * Math.sin(t * 1.6 + s.tw));
        X.fillStyle = '#FFF4E8';
        X.beginPath();
        X.arc(v.x + x, s.y, s.r, 0, 7);
        X.fill();
      }
      X.globalAlpha = 1;
    }

    const sx = VIEW.w * 0.75;
    const sy = lerp(VIEW.h * 0.82, VIEW.h * 0.18, day);
    const R = lerp(42, 60, day);
    const sc = mix([255, 140, 90], [255, 226, 160], day);
    const h = X.createRadialGradient(sx, sy, 0, sx, sy, R * 6);
    h.addColorStop(0, rgba(sc, 0.4 * (1 - d)));
    h.addColorStop(0.4, rgba(sc, 0.11 * (1 - d)));
    h.addColorStop(1, rgba(sc, 0));
    X.fillStyle = h;
    X.beginPath();
    X.arc(sx, sy, R * 6, 0, 7);
    X.fill();
    X.fillStyle = rgba(sc, 0.9 * (1 - d * 0.7));
    X.beginPath();
    X.arc(sx, sy, R, 0, 7);
    X.fill();
  }

  private drawBG(cam: number): void {
    const X = this.ctx;
    const v = this.view;
    const off = (cam * 0.2) % 8000;
    X.save();
    X.translate(-off, 0);
    X.fillStyle = 'rgba(10,8,26,.62)';
    if (this.map.bg === 'city') {
      for (const b of this.buildings) {
        if (b.x - off > v.x + v.w + 200 || b.x - off < v.x - 300) continue;
        X.fillRect(b.x, VIEW.h * 0.72 - b.h, b.w, b.h + 200);
        X.fillStyle = 'rgba(255,206,92,.16)';
        b.lit.forEach((on, i) => {
          if (on) X.fillRect(b.x + 6, VIEW.h * 0.72 - b.h + 8 + i * 26, b.w - 12, 9);
        });
        X.fillStyle = 'rgba(10,8,26,.62)';
      }
    } else if (this.map.bg === 'peaks') {
      for (const pk of this.peaks) {
        if (pk.x - off > v.x + v.w + 300 || pk.x - off < v.x - 400) continue;
        X.beginPath();
        X.moveTo(pk.x, VIEW.h * 0.78);
        X.lineTo(pk.x + pk.w / 2, VIEW.h * 0.78 - pk.h);
        X.lineTo(pk.x + pk.w, VIEW.h * 0.78);
        X.closePath();
        X.fill();
      }
    } else if (this.ridge.length) {
      X.beginPath();
      X.moveTo(0, v.y + v.h);
      for (const pt of this.ridge) X.lineTo(pt.x, pt.y);
      X.lineTo(this.ridge[this.ridge.length - 1]!.x, v.y + v.h);
      X.closePath();
      X.fill();
    }
    X.restore();

    if (this.map.amb) {
      for (const p of this.amb) {
        X.globalAlpha = p.a;
        X.fillStyle = rgba(p.c, 1);
        X.beginPath();
        X.arc(p.x, p.y, p.r, 0, 7);
        X.fill();
      }
      X.globalAlpha = 1;
    }

    const hz = X.createLinearGradient(0, VIEW.h * 0.7, 0, v.y + v.h);
    hz.addColorStop(0, 'rgba(10,8,26,0)');
    hz.addColorStop(1, 'rgba(10,8,26,.9)');
    X.fillStyle = hz;
    X.fillRect(v.x, VIEW.h * 0.7, v.w, v.y + v.h - VIEW.h * 0.7);
  }

  private drawCandle(c: SimSnapshot['candles'][number], cam: number, t: number, warn: boolean): void {
    const X = this.ctx;
    const v = this.view;
    const x = c.x - cam;
    if (x > v.x + v.w + 80 || x + c.w < v.x - 80) return;
    const col = COL[c.kind];
    const gh = this.ghost.get(c.i) ?? 0;
    const sol = 1 - gh;
    const y = c.y;
    const bh = c.bodyH;

    if (gh > 0.05) {
      // A hole. It has to read as unmistakably empty — you fall straight through it.
      X.save();
      X.globalAlpha = gh;
      X.fillStyle = 'rgba(4,3,14,.5)';
      X.beginPath();
      X.roundRect(x, y, c.w, bh, 4);
      X.fill();
      X.setLineDash([5, 6]);
      X.lineWidth = 1.4;
      X.strokeStyle = rgba(col, 0.42);
      X.beginPath();
      X.roundRect(x + 0.7, y + 0.7, c.w - 1.4, bh - 1.4, 4);
      X.stroke();
      X.setLineDash([]);
      X.strokeStyle = rgba(col, 0.22);
      X.lineWidth = 1.2;
      X.beginPath();
      X.moveTo(x + 9, y + 9);
      X.lineTo(x + c.w - 9, y + bh - 9);
      X.moveTo(x + c.w - 9, y + 9);
      X.lineTo(x + 9, y + bh - 9);
      X.stroke();
      X.restore();
    }
    if (sol <= 0.05) return;

    const wick = 9 + hash01(c.i, 0x9e37) * 19;
    X.globalAlpha = sol;
    X.fillStyle = rgba(col, 0.4);
    X.fillRect(x + c.w / 2 - 1.5, y - wick, 3, wick + 4);
    X.fillRect(x + c.w / 2 - 1.5, y + bh - 2, 3, wick * 0.7);
    const bg = X.createLinearGradient(0, y, 0, y + bh);
    bg.addColorStop(0, rgb(mix(col, [255, 255, 255], 0.34)));
    bg.addColorStop(1, rgb(mix(col, [8, 6, 22], 0.34)));
    X.fillStyle = bg;
    X.beginPath();
    X.roundRect(x, y, c.w, bh, 4);
    X.fill();
    X.fillStyle = rgba(mix(col, [255, 255, 255], 0.75), 0.95);
    X.fillRect(x, y, c.w, 2.5);
    X.fillStyle = rgba(mix(col, [255, 255, 255], 0.4), 0.28);
    X.fillRect(x - 2, y - 1.5, c.w + 4, 1.5);
    X.globalAlpha = 1;

    if (warn) {
      // "The tape turns here — flip."
      const pulse = 0.55 + 0.45 * Math.sin(t * 6);
      const cx = x + c.w / 2;
      const ty = y - 30;
      X.save();
      X.globalAlpha = pulse;
      X.strokeStyle = 'rgba(255,206,92,.55)';
      X.lineWidth = 1.4;
      X.setLineDash([3, 5]);
      X.beginPath();
      X.moveTo(cx, y - 8);
      X.lineTo(cx, ty + 8);
      X.stroke();
      X.setLineDash([]);
      X.fillStyle = '#FFCE5C';
      X.beginPath();
      X.moveTo(cx, ty - 6);
      X.lineTo(cx - 7, ty + 4);
      X.lineTo(cx + 7, ty + 4);
      X.closePath();
      X.fill();
      X.font = '700 8px "Martian Mono",monospace';
      X.textAlign = 'center';
      X.fillText('FLIP', cx, ty - 12);
      X.restore();
    }
  }

  private drawPip(p: SimSnapshot['pipsList'][number], cam: number, t: number): void {
    const X = this.ctx;
    const v = this.view;
    const x = p.x - cam;
    if (x < v.x - 40 || x > v.x + v.w + 40) return;
    const b = Math.sin(t * 3 + hash01(p.i, 0x51ed) * 6) * 3;
    X.save();
    X.shadowColor = 'rgba(255,206,92,.9)';
    X.shadowBlur = 13;
    X.fillStyle = '#FFCE5C';
    X.beginPath();
    X.arc(x, p.y + b, 4.2, 0, 7);
    X.fill();
    X.restore();
    X.fillStyle = 'rgba(255,255,255,.85)';
    X.beginPath();
    X.arc(x - 1.2, p.y + b - 1.2, 1.4, 0, 7);
    X.fill();
  }

  private drawPower(p: SimSnapshot['powers'][number], cam: number, t: number): void {
    const X = this.ctx;
    const v = this.view;
    const x = p.x - cam;
    if (x < v.x - 60 || x > v.x + v.w + 60) return;
    const ph = hash01(p.i, 0x2f19) * 6;
    const b = Math.sin(t * 2.4 + ph) * 5;
    const y = p.y + b;
    const col = p.kind === 'lev' ? [255, 206, 92] : p.kind === 'shield' ? [111, 180, 255] : [34, 230, 160];
    X.save();
    X.shadowColor = rgba(col, 0.9);
    X.shadowBlur = 24;
    X.translate(x, y);
    X.rotate(Math.sin(t * 1.5 + ph) * 0.14);
    X.fillStyle = rgba(col, 0.16);
    X.beginPath();
    X.roundRect(-19, -19, 38, 38, 12);
    X.fill();
    X.strokeStyle = rgba(col, 0.95);
    X.lineWidth = 2;
    X.beginPath();
    X.roundRect(-19, -19, 38, 38, 12);
    X.stroke();
    X.restore();

    X.save();
    X.translate(x, y);
    X.strokeStyle = rgba(col, 1);
    X.lineWidth = 2.2;
    X.lineCap = 'round';
    X.lineJoin = 'round';
    X.beginPath();
    if (p.kind === 'lev') {
      X.moveTo(-7, 6);
      X.lineTo(-1, -2);
      X.lineTo(3, 3);
      X.lineTo(9, -6);
      X.moveTo(9, -6);
      X.lineTo(4, -6);
      X.moveTo(9, -6);
      X.lineTo(9, -1);
    }
    if (p.kind === 'shield') {
      X.moveTo(0, -9);
      X.lineTo(8, -5);
      X.lineTo(8, 2);
      X.quadraticCurveTo(8, 8, 0, 10);
      X.quadraticCurveTo(-8, 8, -8, 2);
      X.lineTo(-8, -5);
      X.closePath();
    }
    if (p.kind === 'bull') {
      X.moveTo(-8, -4);
      X.quadraticCurveTo(-8, -9, -3, -9);
      X.moveTo(8, -4);
      X.quadraticCurveTo(8, -9, 3, -9);
      X.moveTo(-5, -2);
      X.quadraticCurveTo(0, 8, 5, -2);
      X.quadraticCurveTo(0, -6, -5, -2);
    }
    X.stroke();
    X.restore();
  }

  private drawPlayer(snap: SimSnapshot, px: number, py: number, cam: number, t: number): void {
    if (!snap.player.alive) return;
    const X = this.ctx;
    const x = px - cam;
    const tint = this.map.longOnly ? [255, 244, 232] : snap.player.short ? [255, 74, 107] : [34, 230, 160];

    for (let i = this.trail.length - 1; i > 0; i--) {
      const tr = this.trail[i]!;
      const a = (1 - i / this.trail.length) * 0.26;
      X.globalAlpha = a;
      X.fillStyle = rgba(tint, 1);
      X.beginPath();
      X.arc(tr.x - cam, tr.y, (1 - i / this.trail.length) * 9, 0, 7);
      X.fill();
    }
    X.globalAlpha = 1;

    const sq = this.sq;
    const w = C.pw * (2 - sq);
    const h = C.ph * sq;
    X.save();
    X.translate(x + C.pw / 2, py + C.ph - h / 2);
    X.rotate(this.rot);
    const col = snap.buffs.lev > 0 ? '#FFCE5C' : snap.buffs.bull > 0 ? '#22E6A0' : this.char.col;
    X.shadowColor = rgba(tint, 0.8);
    X.shadowBlur = 20;
    drawChar(X, this.char.id, w, h, col, t);
    X.shadowBlur = 0;
    if (!this.map.longOnly) {
      X.fillStyle = rgba(tint, 0.95);
      X.beginPath();
      if (snap.player.short) {
        X.moveTo(0, -h * 0.98);
        X.lineTo(-5, -h * 0.98 - 7);
        X.lineTo(5, -h * 0.98 - 7);
      } else {
        X.moveTo(0, -h * 0.98 - 8);
        X.lineTo(-5, -h * 0.98 - 1);
        X.lineTo(5, -h * 0.98 - 1);
      }
      X.closePath();
      X.fill();
    }
    if (snap.buffs.shield) {
      X.strokeStyle = 'rgba(111,180,255,.85)';
      X.lineWidth = 2;
      X.beginPath();
      X.arc(0, 0, w * 0.95 + Math.sin(t * 4) * 2, 0, 7);
      X.stroke();
    }
    X.restore();
  }

  private drawHint(hint: number, px: number, py: number, cam: number, t: number): void {
    if (!hint) return;
    const X = this.ctx;
    const txt =
      hint === 1
        ? this.map.longOnly
          ? 'TAP TO JUMP'
          : 'TAP LEFT — JUMP'
        : hint === 2
          ? 'TAP AGAIN IN THE AIR'
          : 'TAP RIGHT WHEN YOU SEE "FLIP"';
    const x = px - cam + C.pw / 2;
    const y = py - 46 + Math.sin(t * 4) * 4;
    X.save();
    X.textAlign = 'center';
    X.textBaseline = 'middle';
    X.font = '400 10px "Martian Mono",ui-monospace,monospace';
    const w = X.measureText(txt).width + 24;
    X.fillStyle = 'rgba(10,8,26,.82)';
    X.beginPath();
    X.roundRect(x - w / 2, y - 12, w, 24, 12);
    X.fill();
    X.strokeStyle = 'rgba(255,206,92,.45)';
    X.lineWidth = 1;
    X.stroke();
    X.fillStyle = '#FFCE5C';
    X.fillText(txt, x, y);
    X.beginPath();
    X.moveTo(x - 5, y + 12);
    X.lineTo(x + 5, y + 12);
    X.lineTo(x, y + 18);
    X.closePath();
    X.fill();
    X.restore();
  }

  private drawParts(cam: number): void {
    const X = this.ctx;
    for (const p of this.parts) {
      X.globalAlpha = clamp(p.l / p.m, 0, 1) * 0.9;
      X.fillStyle = rgba(p.c, 1);
      X.beginPath();
      X.arc(p.x - cam, p.y, p.r, 0, 7);
      X.fill();
    }
    X.globalAlpha = 1;
  }

  /** Where a pointer landed, in virtual coordinates — the jump/flip split is at the middle. */
  isLeftHalf(clientX: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    return clientX - rect.left < rect.width * 0.5;
  }
}
