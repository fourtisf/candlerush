import { describe, expect, it } from 'vitest';
import {
  ENGINE_VERSION,
  IN,
  LEVEL,
  MAX_FRAMES,
  Sim,
  digest,
  runReplay,
  type InputEvent,
  type SessionConfig,
} from '../src/index.js';
import { playBot } from './bot.js';

const cfg = (over: Partial<SessionConfig> = {}): SessionConfig => ({
  seed: 12345,
  mapId: 'night',
  charId: 'bull',
  handicap: 0,
  engineVersion: ENGINE_VERSION,
  ...over,
});

describe('determinism', () => {
  it('same seed + same inputs produce an identical final state, 100 times over', () => {
    const base = cfg();
    const { tape } = playBot(base, 7);
    expect(tape.length).toBeGreaterThan(30);

    const first = runReplay({ ...base, inputs: tape });
    expect(first.ok).toBe(true);
    expect(first.score).toBeGreaterThan(0);

    for (let i = 0; i < 100; i++) {
      const again = runReplay({ ...base, inputs: tape });
      expect(again.digest).toBe(first.digest);
      expect(again.score).toBe(first.score);
      expect(again.frames).toBe(first.frames);
      expect(again.endReason).toBe(first.endReason);
    }
  });

  it('a live run and a replay of its own tape agree exactly', () => {
    for (const seed of [1, 2, 3, 99, 4242, 2 ** 31 - 1]) {
      for (const mapId of ['dawn', 'night', 'red', 'gold'] as const) {
        const base = cfg({ seed, mapId });
        const { tape, sim } = playBot(base, seed);
        const replayed = runReplay({ ...base, inputs: tape });
        expect(replayed.ok, `${mapId}/${seed}: ${replayed.error} ${replayed.errorDetail}`).toBe(true);
        expect(replayed.score, `${mapId}/${seed}`).toBe(sim.score);
        expect(replayed.digest, `${mapId}/${seed}`).toBe(digest(sim));
        expect(replayed.candles).toBe(sim.cleared);
        expect(replayed.bestMult).toBe(sim.bestMult);
        expect(replayed.cleanFlips).toBe(sim.cleanFlips);
      }
    }
  });

  it('every character produces a reproducible run', () => {
    for (const charId of ['bull', 'bear', 'fox', 'whale', 'ape', 'gem'] as const) {
      const base = cfg({ charId, seed: 808 });
      const { tape, sim } = playBot(base, 11);
      const replayed = runReplay({ ...base, inputs: tape });
      expect(replayed.ok, `${charId}: ${replayed.error}`).toBe(true);
      expect(replayed.digest, charId).toBe(digest(sim));
    }
  });

  it('a revived session replays identically', () => {
    // The revive splices a runway in at wherever the camera drifted to during the offer,
    // so it is the one place where the world depends on the tape. Worth its own case.
    let found = false;
    for (let seed = 1; seed < 60 && !found; seed++) {
      const base = cfg({ seed, mapId: 'red' });
      const { tape, sim } = playBot(base, seed, { revive: true });
      if (!sim.usedRevive) continue;
      found = true;
      const replayed = runReplay({ ...base, inputs: tape });
      expect(replayed.ok, `${replayed.error} ${replayed.errorDetail}`).toBe(true);
      expect(replayed.digest).toBe(digest(sim));
      expect(replayed.score).toBe(sim.score);
    }
    expect(found, 'no seed in 1..60 produced a revive').toBe(true);
  });

  it('collecting render events does not change the simulation', () => {
    const base = cfg({ seed: 77 });
    const { tape } = playBot(base, 3);

    const quiet = new Sim(base);
    const loud = new Sim(base, { events: true });
    let cursor = 0;
    for (let f = 0; f < MAX_FRAMES && quiet.mode !== 'ended'; f++) {
      while (cursor < tape.length && tape[cursor]![0] === f) {
        quiet.applyInput(tape[cursor]![1]);
        loud.applyInput(tape[cursor]![1]);
        cursor++;
      }
      quiet.step();
      loud.step();
      loud.drainEvents();
    }
    expect(digest(loud)).toBe(digest(quiet));
  });

  it('handicap is part of the session identity, not something the client can pick', () => {
    // The handicap dampens the speed ramp, so the same tape under a different handicap is
    // a different run — and usually an invalid one, because the player ends up somewhere
    // the tape does not account for. Either outcome proves the point: it has to be issued
    // with the session, exactly like the seed.
    const base = cfg({ seed: 555, handicap: 0 });
    const { tape } = playBot(base, 5);
    const straight = runReplay({ ...base, inputs: tape });
    const eased = runReplay({ ...base, handicap: 1, inputs: tape });
    expect(straight.ok).toBe(true);
    expect(eased.ok && eased.digest === straight.digest).toBe(false);
  });

  it('replays identically across level boundaries', () => {
    // The level transition throws away the generated tape ahead of the player and rebuilds
    // it at the new difficulty. That is the most state-dependent thing the world does, so
    // it is the most likely place for the server and the browser to part company.
    const base = cfg({ seed: 4242, mapId: 'night' });
    const { tape, sim } = playBot(base, 21);
    expect(sim.level, 'the bot never cleared a level — nothing was exercised').toBeGreaterThan(1);

    const replayed = runReplay({ ...base, inputs: tape });
    expect(replayed.ok, `${replayed.error} ${replayed.errorDetail}`).toBe(true);
    expect(replayed.digest).toBe(digest(sim));
    expect(replayed.score).toBe(sim.score);
    expect(replayed.level).toBe(sim.level);
  });

  // A sim with no inputs falls off the first gap, so the structural level tests need a
  // player. A metronome of jumps on tier 1 survives indefinitely, which is all they need.
  const drive = (sim: Sim, frames: number, opts: { autoContinue?: boolean } = {}): void => {
    for (let f = 0; f < frames && sim.mode !== 'ended'; f++) {
      if (sim.mode === 'levelBreak') {
        if (opts.autoContinue) sim.applyInput(IN.CONTINUE);
      } else if (f >= 40 && (f - 40) % 37 === 0) {
        sim.applyInput(IN.JUMP_DOWN);
      } else if (f >= 49 && (f - 49) % 37 === 0) {
        sim.applyInput(IN.JUMP_UP);
      }
      sim.step();
    }
  };

  it('a level is exactly as long as it says it is', () => {
    const sim = new Sim(cfg({ seed: 8, mapId: 'dawn' }));
    drive(sim, LEVEL.seconds * 60 - 1);
    expect(sim.mode, 'the driver died before the level ended').toBe('running');
    expect(sim.level).toBe(1);
    sim.step();
    expect(sim.mode).toBe('levelBreak');
  });

  it('the level panel continues by itself so a tape cannot stall on it', () => {
    const sim = new Sim(cfg({ seed: 8, mapId: 'dawn' }));
    drive(sim, LEVEL.seconds * 60);
    expect(sim.mode).toBe('levelBreak');
    // No input at all from here: the panel has to time out on its own.
    for (let i = 0; i < LEVEL.breakSeconds * 60; i++) sim.step();
    expect(sim.mode).toBe('running');
    expect(sim.level).toBe(2);
  });

  it('Back on the level panel ends the run and keeps every dollar earned', () => {
    const sim = new Sim(cfg({ seed: 8, mapId: 'dawn' }));
    drive(sim, LEVEL.seconds * 60);
    expect(sim.mode).toBe('levelBreak');
    const banked = sim.score;
    expect(banked, 'the driver cleared a level without scoring — nothing to bank').toBeGreaterThan(0);

    sim.applyInput(IN.DECLINE);
    expect(sim.mode).toBe('ended');
    // Distinct from `declined`, which is turning down a top-up after being liquidated.
    expect(sim.endReason).toBe('cashedOut');
    expect(sim.score).toBe(banked);
    expect(sim.p.alive).toBe(true);

    // Whatever the server replays has to reach the same number, or "Back" would be a
    // button that pays out differently depending on who added it up.
    const base = cfg({ seed: 8, mapId: 'dawn' });
    const tape: InputEvent[] = [];
    const rec = new Sim(base);
    for (let f = 0; f < LEVEL.seconds * 60 && rec.mode !== 'ended'; f++) {
      if (f >= 40 && (f - 40) % 37 === 0) {
        tape.push([f, IN.JUMP_DOWN]);
        rec.applyInput(IN.JUMP_DOWN);
      } else if (f >= 49 && (f - 49) % 37 === 0) {
        tape.push([f, IN.JUMP_UP]);
        rec.applyInput(IN.JUMP_UP);
      }
      rec.step();
    }
    tape.push([rec.frame, IN.DECLINE]);
    rec.applyInput(IN.DECLINE);
    rec.step(); // the input lands at the head of a frame, and that frame still ticks
    const replayed = runReplay({ ...base, inputs: tape });
    expect(replayed.ok, `${replayed.error} ${replayed.errorDetail}`).toBe(true);
    expect(replayed.score).toBe(rec.score);
    expect(replayed.endReason).toBe('cashedOut');
    expect(replayed.digest).toBe(digest(rec));
  });

  it('Back does nothing while a level is actually running', () => {
    // DECLINE is live in two modes now. If it leaked into `running` a stray press would
    // end somebody's session mid-jump.
    const a = new Sim(cfg({ seed: 12 }));
    const b = new Sim(cfg({ seed: 12 }));
    for (let i = 0; i < 300; i++) {
      a.applyInput(IN.DECLINE);
      a.step();
      b.step();
    }
    expect(a.mode).not.toBe('ended');
    expect(digest(a)).toBe(digest(b));
  });

  it('CONTINUE does nothing outside the level panel', () => {
    const a = new Sim(cfg({ seed: 11 }));
    const b = new Sim(cfg({ seed: 11 }));
    for (let i = 0; i < 300; i++) {
      a.applyInput(IN.CONTINUE);
      a.step();
      b.step();
    }
    expect(digest(a)).toBe(digest(b));
  });

  it('every level opens faster than the one before it', () => {
    const sim = new Sim(cfg({ seed: 8, mapId: 'dawn' }));
    const openingSpeed: number[] = [];
    let seen = 0;
    for (let f = 0; f < MAX_FRAMES && sim.mode !== 'ended' && seen < 4; f++) {
      if (sim.mode === 'levelBreak') sim.applyInput(IN.CONTINUE);
      else if (f >= 40 && (f - 40) % 37 === 0) sim.applyInput(IN.JUMP_DOWN);
      else if (f >= 49 && (f - 49) % 37 === 0) sim.applyInput(IN.JUMP_UP);
      if (sim.level > seen && sim.mode === 'running') {
        openingSpeed.push(sim.spd);
        seen = sim.level;
      }
      sim.step();
    }
    expect(openingSpeed.length, `only reached level ${sim.level}`).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < openingSpeed.length; i++) {
      expect(openingSpeed[i]!, `level ${i + 1} opened slower than level ${i}`).toBeGreaterThan(
        openingSpeed[i - 1]!,
      );
    }
  });

  it('never touches unseeded randomness', () => {
    // The engine may not reach for Math.random, Date or performance: the first would
    // desync the replay, the others would make the sim depend on wall clock. Poison all
    // three and run a full session over the top of them.
    const real = { random: Math.random, now: Date.now, dateNow: globalThis.Date };
    const base = cfg({ seed: 606, mapId: 'gold', charId: 'ape' });
    const { tape } = playBot(base, 606);
    Math.random = () => {
      throw new Error('engine called Math.random');
    };
    Date.now = () => {
      throw new Error('engine called Date.now');
    };
    try {
      const r = runReplay({ ...base, inputs: tape });
      expect(r.ok).toBe(true);
    } finally {
      Math.random = real.random;
      Date.now = real.now;
    }
  });

  it('the world is a pure function of seed, map and character', () => {
    const a = new Sim(cfg({ seed: 31337 }));
    const b = new Sim(cfg({ seed: 31337 }));
    for (let i = 0; i < 600; i++) {
      a.step();
      b.step();
    }
    expect(digest(a)).toBe(digest(b));

    const c = new Sim(cfg({ seed: 31338 }));
    for (let i = 0; i < 600; i++) c.step();
    expect(digest(c)).not.toBe(digest(a));
  });
});
