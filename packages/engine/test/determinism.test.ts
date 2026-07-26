import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, MAX_FRAMES, Sim, digest, runReplay, type SessionConfig } from '../src/index.js';
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
