import { ENGINE_VERSION, STEP, Sim, type CharId, type MapId } from '@candle-rush/engine';
import { guestSeed } from '../../lib/guest';
import type { Renderer } from './renderer';

/**
 * The menu backdrop: the tape scrolling by behind the panels, exactly as the prototype
 * does between runs. It is a throwaway simulation with a throwaway seed and no player,
 * and it never produces a score.
 */
export class AttractLoop {
  private sim: Sim;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;

  constructor(
    private readonly renderer: Renderer,
    mapId: MapId,
    charId: CharId,
  ) {
    this.sim = new Sim(
      { seed: guestSeed(), mapId, charId, handicap: 0, engineVersion: ENGINE_VERSION },
      { mode: 'attract' },
    );
  }

  restart(mapId: MapId, charId: CharId): void {
    this.sim = new Sim(
      { seed: guestSeed(), mapId, charId, handicap: 0, engineVersion: ENGINE_VERSION },
      { mode: 'attract' },
    );
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

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 120) {
      this.sim.step();
      this.acc -= STEP;
      steps++;
    }
    const snap = this.sim.snapshot();
    this.renderer.update(dt, snap);
    this.renderer.render(snap, this.acc / STEP, { hint: 0, paused: false, t: snap.t });
    this.raf = requestAnimationFrame(this.frame);
  };
}
