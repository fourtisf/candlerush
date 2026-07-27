import {
  IN,
  MAX_INPUTS,
  MAX_PRESSES_PER_SEC,
  STEP,
  Sim,
  digest,
  type InputEvent,
  type SessionConfig,
  type SimEvent,
  type SimSnapshot,
} from '@candle-rush/engine';
import { Snd } from './audio';
import type { Renderer } from './renderer';

/**
 * A live session: the simulation, the input tape, and the frame loop that drives them.
 *
 * The loop is a fixed-timestep accumulator. Rendering interpolates between steps so the
 * game looks right on a 144Hz display, but `sim.step()` never sees wall-clock time — that
 * is the whole reason a server can reproduce the run.
 *
 * Inputs are recorded on the frame they are applied to, which is the next simulation step
 * after the press, not the moment the DOM event fired. Browser and server therefore agree
 * about when a button went down.
 */

const PRESS_CODES: readonly number[] = [IN.JUMP_DOWN, IN.FLIP, IN.REVIVE, IN.DECLINE];

export interface SessionCallbacks {
  onEvents?: (events: readonly SimEvent[], snap: SimSnapshot) => void;
  onTick?: (snap: SimSnapshot) => void;
  onEnd?: (session: LiveSession) => void;
  /** Fired when the wall-clock budget is nearly spent while paused. */
  onPauseExpiring?: (secondsLeft: number) => void;
}

export interface SessionOptions {
  /** Server-issued session id. Absent for guest play, which is never ranked. */
  sessionId?: string;
  /** Wall-clock ceiling the server will accept, in ms. Pausing eats into it. */
  maxElapsedMs?: number;
}

export class LiveSession {
  readonly sim: Sim;
  readonly tape: InputEvent[] = [];
  readonly startedAt = Date.now();
  readonly sessionId?: string;

  paused = false;
  /** Set when the tape was truncated by the anti-mash throttle; purely diagnostic. */
  droppedInputs = 0;

  private pending: number[] = [];
  private pressFrames: number[] = [];
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private hint: 0 | 1 | 2 | 3 = 0;
  private hintT = 0;
  private readonly maxElapsedMs: number;

  constructor(
    readonly config: SessionConfig,
    private readonly renderer: Renderer,
    private readonly cb: SessionCallbacks = {},
    opts: SessionOptions = {},
  ) {
    this.sim = new Sim(config, { events: true });
    this.sessionId = opts.sessionId;
    // Tracks SESSION_MAX_ELAPSED_MS on the server. It is only used to warn a paused
    // player before their submission window closes, so being wrong here costs them a run.
    this.maxElapsedMs = opts.maxElapsedMs ?? 900_000;
  }

  /** Show the tutorial prompts. First run only; purely cosmetic. */
  enableHints(): void {
    this.hint = 1;
    this.hintT = 9;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  /** Seconds of pausing left before the server would reject the submission. */
  wallClockLeft(): number {
    return Math.max(0, (this.maxElapsedMs - this.elapsedMs()) / 1000);
  }

  setPaused(paused: boolean): void {
    if (this.sim.mode === 'ended') return;
    this.paused = paused;
    this.last = performance.now();
  }

  /**
   * Queue an input. It is applied — and stamped — at the start of the next simulation
   * step, so two players on different refresh rates record the same frame for the same
   * reaction time.
   */
  press(code: number): void {
    if (this.sim.mode === 'ended' || this.paused) return;
    if (this.tape.length + this.pending.length >= MAX_INPUTS) return;
    this.pending.push(code);
  }

  private drainInputs(): void {
    if (!this.pending.length) return;
    const frame = this.sim.frame;
    for (const code of this.pending) {
      if (PRESS_CODES.includes(code)) {
        // Client-side throttle matching the server's bot filter. A human cannot tap
        // twelve times a second; dropping the excess here means a mashing player gets a
        // valid tape rather than a rejected session they cannot explain.
        while (this.pressFrames.length && this.pressFrames[0]! <= frame - 60) this.pressFrames.shift();
        if (this.pressFrames.length >= MAX_PRESSES_PER_SEC) {
          this.droppedInputs++;
          continue;
        }
        this.pressFrames.push(frame);
      }
      this.tape.push([frame, code]);
      this.sim.applyInput(code);
    }
    this.pending.length = 0;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;

    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      const before = this.sim.t;
      while (this.acc >= STEP && this.sim.mode !== 'ended' && steps < 240) {
        this.drainInputs();
        this.sim.step();
        const events = this.sim.drainEvents();
        if (events.length) {
          this.playSounds(events);
          this.hintsFromEvents(events);
          this.renderer.consume(events);
          this.cb.onEvents?.(events, this.sim.snapshot());
        }
        this.acc -= STEP;
        steps++;
      }
      this.tickHints(this.sim.t - before);
      if (this.sim.mode === 'ended') this.acc = 0;
    } else if (this.wallClockLeft() < 30) {
      this.cb.onPauseExpiring?.(this.wallClockLeft());
    }

    const snap = this.sim.snapshot();
    this.renderer.update(dt, snap);
    this.renderer.render(snap, this.paused ? 0 : this.acc / STEP, {
      hint: this.hint,
      paused: this.paused,
      t: snap.t,
    });
    this.cb.onTick?.(snap);

    // The loop keeps running after the run is over: the sim ignores further steps, but the
    // death burst and the settling particles still need frames to play out under the
    // results panel. The caller stops it when it starts the next run.
    if (this.sim.mode === 'ended') this.announceEnd();
    this.raf = requestAnimationFrame(this.frame);
  };

  private ended = false;

  private announceEnd(): void {
    if (this.ended) return;
    this.ended = true;
    this.cb.onEnd?.(this);
  }

  /**
   * Tutorial prompt state machine, ported from the prototype. It used to live in the
   * simulation; it is here now because it changes nothing about the run, and anything
   * that changes nothing about the run has no business in the engine.
   */
  private tickHints(elapsed: number): void {
    if (!this.hint || this.hintT <= 0) return;
    this.hintT -= elapsed;
    if (this.hintT > 0) return;
    if (this.hint === 2 && !this.sim.map.longOnly) {
      this.hint = 3;
      this.hintT = 6;
    } else {
      this.hint = 0;
      this.hintT = 0;
    }
  }

  private hintsFromEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.t === 'jump' && e.first && this.hint === 1) {
        this.hint = 2;
        this.hintT = 4;
      } else if (e.t === 'jump' && !e.first && this.hint === 2) {
        this.hint = this.sim.map.longOnly ? 0 : 3;
        this.hintT = this.hint ? 6 : 0;
      } else if (e.t === 'flip' && this.hint === 3) {
        this.hint = 0;
        this.hintT = 0;
      }
    }
  }

  private playSounds(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.t) {
        case 'jump':
          e.first ? Snd.jump() : Snd.dbl();
          break;
        case 'land':
          Snd.land();
          if (e.perfect) Snd.perfect();
          break;
        case 'flip':
          Snd.flip(!e.short);
          break;
        case 'pip':
          Snd.pip(e.n);
          break;
        case 'power':
        case 'shield':
        case 'revive':
          Snd.power();
          break;
        case 'stumble':
          Snd.bad();
          break;
        case 'death':
          Snd.die();
          break;
        case 'bell':
          Snd.bell();
          break;
        case 'end':
          if (e.reason === 'cleared') Snd.bell();
          break;
        default:
          break;
      }
    }
  }

  /** What gets POSTed. The score is included only so the server can log a mismatch. */
  submission(): { sessionId: string; inputs: InputEvent[]; clientScore: number; clientDigest: string } | null {
    if (!this.sessionId) return null;
    return {
      sessionId: this.sessionId,
      inputs: this.tape,
      clientScore: this.sim.score,
      clientDigest: digest(this.sim),
    };
  }
}
