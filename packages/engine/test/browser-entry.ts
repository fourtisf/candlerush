import { ENGINE_VERSION, digest, runReplay, type SessionConfig } from '../src/index.js';
import { playBot } from './bot.js';

/** Bundled into the page by cross-env.browser.ts. Nothing here runs in production. */
(globalThis as unknown as Record<string, unknown>).CR = {
  ENGINE_VERSION,
  play(cfg: SessionConfig, noise: number) {
    const { tape, sim } = playBot(cfg, noise);
    return { tape, digest: digest(sim), score: sim.score, frames: sim.frame, cleared: sim.cleared };
  },
  replay: runReplay,
};
