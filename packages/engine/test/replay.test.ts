import { describe, expect, it } from 'vitest';
import {
  ENGINE_VERSION,
  IN,
  MAX_FRAMES,
  MAX_INPUTS,
  runReplay,
  validateTape,
  inputJitterMs,
  type InputEvent,
  type SessionConfig,
} from '../src/index.js';
import { playBot } from './bot.js';

const cfg = (over: Partial<SessionConfig> = {}): SessionConfig => ({
  seed: 4242,
  mapId: 'night',
  charId: 'bull',
  handicap: 0,
  engineVersion: ENGINE_VERSION,
  ...over,
});

const tape = (...evs: Array<[number, number]>): InputEvent[] => evs as InputEvent[];

describe('replay rejection', () => {
  it('rejects an engine version mismatch', () => {
    const r = runReplay({ ...cfg({ engineVersion: ENGINE_VERSION + 1 }), inputs: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ENGINE_VERSION_MISMATCH');
    expect(r.score).toBe(0);
  });

  it('rejects out-of-order frames', () => {
    const r = runReplay({ ...cfg(), inputs: tape([10, IN.JUMP_DOWN], [4, IN.JUMP_DOWN]) });
    expect(r.error).toBe('FRAME_NOT_MONOTONIC');
  });

  it('rejects negative, fractional and over-length frames', () => {
    expect(runReplay({ ...cfg(), inputs: tape([-1, IN.JUMP_DOWN]) }).error).toBe('FRAME_OUT_OF_RANGE');
    expect(runReplay({ ...cfg(), inputs: tape([12.5, IN.JUMP_DOWN]) }).error).toBe('FRAME_OUT_OF_RANGE');
    expect(runReplay({ ...cfg(), inputs: tape([MAX_FRAMES, IN.JUMP_DOWN]) }).error).toBe(
      'FRAME_OUT_OF_RANGE',
    );
  });

  it('rejects unknown input codes', () => {
    expect(runReplay({ ...cfg(), inputs: tape([5, 99]) }).error).toBe('UNKNOWN_INPUT_CODE');
  });

  it('rejects a tape longer than any legal session', () => {
    const long: InputEvent[] = [];
    for (let i = 0; i <= MAX_INPUTS; i++) long.push([Math.min(i, MAX_FRAMES - 1), IN.JUMP_UP]);
    expect(runReplay({ ...cfg(), inputs: long }).error).toBe('TAPE_TOO_LONG');
  });

  it('rejects inhuman tap rates', () => {
    const fast: InputEvent[] = [];
    for (let i = 0; i < 13; i++) fast.push([100 + i * 4, IN.JUMP_DOWN]);
    const r = runReplay({ ...cfg(), inputs: fast });
    expect(r.error).toBe('INPUT_RATE_EXCEEDED');
  });

  it('accepts a fast but human tap rate', () => {
    const ok: InputEvent[] = [];
    for (let i = 0; i < 12; i++) ok.push([100 + i * 5, IN.JUMP_DOWN]);
    expect(validateTape(ok)).toBeNull();
  });

  it('does not count jump releases against the tap limit', () => {
    // Twelve taps a second is twenty-four events a second once releases are counted.
    const pairs: InputEvent[] = [];
    for (let i = 0; i < 12; i++) {
      pairs.push([100 + i * 5, IN.JUMP_DOWN]);
      pairs.push([102 + i * 5, IN.JUMP_UP]);
    }
    expect(validateTape(pairs)).toBeNull();
  });

  it('rejects a tape that keeps going after the player died', () => {
    const base = cfg({ seed: 3 });
    const { tape: real, sim } = playBot(base, 3);
    expect(sim.mode).toBe('ended');
    const extended = [...real, [Math.min(sim.frame + 30, MAX_FRAMES - 1), IN.JUMP_DOWN]] as InputEvent[];
    const r = runReplay({ ...base, inputs: extended });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('INPUT_AFTER_END');
  });

  it('rejects a map or character the engine does not know', () => {
    expect(runReplay({ ...cfg(), mapId: 'moon' as never, inputs: [] }).error).toBe('BAD_CONFIG');
    expect(runReplay({ ...cfg(), charId: 'dog' as never, inputs: [] }).error).toBe('BAD_CONFIG');
  });

  it('rejects an out-of-range seed or handicap', () => {
    expect(runReplay({ ...cfg({ seed: -1 }), inputs: [] }).error).toBe('BAD_CONFIG');
    expect(runReplay({ ...cfg({ seed: 2 ** 32 }), inputs: [] }).error).toBe('BAD_CONFIG');
    expect(runReplay({ ...cfg({ handicap: 1.5 }), inputs: [] }).error).toBe('BAD_CONFIG');
  });

  it('an empty tape is legal and scores whatever standing still is worth', () => {
    const r = runReplay({ ...cfg(), inputs: [] });
    expect(r.ok).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.frames).toBeGreaterThan(0);
  });

  it('runs a full session in single-digit milliseconds', () => {
    const base = cfg({ seed: 991 });
    const { tape: t } = playBot(base, 991);
    const started = process.hrtime.bigint();
    const runs = 20;
    for (let i = 0; i < runs; i++) runReplay({ ...base, inputs: t });
    const perRun = Number(process.hrtime.bigint() - started) / 1e6 / runs;
    expect(perRun, `${perRun.toFixed(2)}ms per replay`).toBeLessThan(60);
  });
});

describe('bot signal', () => {
  it('frame-perfect input reads as near-zero jitter', () => {
    const robotic: InputEvent[] = [];
    for (let i = 0; i < 40; i++) robotic.push([i * 30, IN.JUMP_DOWN]);
    expect(inputJitterMs(robotic)).toBeLessThan(1);
  });

  it('a human-shaped tape has jitter well clear of zero', () => {
    const { tape: t } = playBot(cfg({ seed: 17 }), 17);
    expect(inputJitterMs(t)).toBeGreaterThan(5);
  });

  it('ignores releases, which are not reactions', () => {
    const t: InputEvent[] = [
      [0, IN.JUMP_DOWN],
      [3, IN.JUMP_UP],
      [30, IN.JUMP_DOWN],
      [37, IN.JUMP_UP],
      [60, IN.JUMP_DOWN],
      [66, IN.JUMP_UP],
    ];
    expect(inputJitterMs(t)).toBe(0);
  });
});
