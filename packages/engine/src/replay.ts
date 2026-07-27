import { ENGINE_VERSION, MAX_FRAMES, STEP, isCharId, isMapId } from './config.js';
import { digest } from './digest.js';
import { Sim } from './sim.js';
import { INPUT_CODES, IN, type InputTape, type ReplayResult, type SessionConfig } from './types.js';

/**
 * Hard caps on a legal tape.
 *
 * `MAX_PRESSES_PER_SEC` is the crude bot filter from the handoff: no human taps twelve
 * times a second. It counts deliberate actions only — a jump *release* is not a tap, and
 * counting it would halve the real limit to six taps a second, which a mashing human can
 * beat. Releases are bounded separately by `MAX_INPUTS_PER_SEC`.
 */
export const MAX_PRESSES_PER_SEC = 12;
export const MAX_INPUTS_PER_SEC = 30;
export const MAX_INPUTS = Math.ceil((MAX_FRAMES / 60) * MAX_INPUTS_PER_SEC);

const PRESS_CODES = new Set<number>([IN.JUMP_DOWN, IN.FLIP, IN.REVIVE, IN.DECLINE, IN.CONTINUE]);
/** Presses that represent a reaction, and so ought to carry human timing jitter. */
const REACTION_CODES = new Set<number>([IN.JUMP_DOWN, IN.FLIP]);

export interface ReplayRequest extends SessionConfig {
  inputs: InputTape;
}

function fail(error: ReplayResult['error'], detail?: string): ReplayResult {
  return {
    ok: false,
    error,
    errorDetail: detail,
    score: 0,
    candles: 0,
    bestMult: 0,
    cleanFlips: 0,
    flips: 0,
    pips: 0,
    level: 0,
    frames: 0,
    endReason: null,
    inputJitterMs: 0,
    inputCount: 0,
    digest: '',
  };
}

/** Stddev of the gaps between reaction presses, in ms. Frame-perfect bots sit near zero. */
export function inputJitterMs(inputs: InputTape): number {
  const frames: number[] = [];
  for (const [f, k] of inputs) if (REACTION_CODES.has(k)) frames.push(f);
  if (frames.length < 3) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < frames.length; i++) gaps.push((frames[i]! - frames[i - 1]!) * STEP * 1000);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const varr = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
  return Math.sqrt(varr);
}

/** Structural validation. Runs before the sim so a malformed tape costs nothing. */
export function validateTape(inputs: InputTape): { error: ReplayResult['error']; detail?: string } | null {
  if (inputs.length > MAX_INPUTS) {
    return { error: 'TAPE_TOO_LONG', detail: `${inputs.length} > ${MAX_INPUTS}` };
  }
  let prev = -1;
  for (let i = 0; i < inputs.length; i++) {
    const ev = inputs[i]!;
    if (!Array.isArray(ev) || ev.length !== 2) {
      return { error: 'UNKNOWN_INPUT_CODE', detail: `entry ${i} is not [frame, code]` };
    }
    const [f, k] = ev;
    if (!Number.isInteger(f) || f < 0 || f >= MAX_FRAMES) {
      return { error: 'FRAME_OUT_OF_RANGE', detail: `entry ${i} frame ${f}` };
    }
    if (f < prev) return { error: 'FRAME_NOT_MONOTONIC', detail: `entry ${i} frame ${f} < ${prev}` };
    prev = f;
    if (!Number.isInteger(k) || !INPUT_CODES.includes(k)) {
      return { error: 'UNKNOWN_INPUT_CODE', detail: `entry ${i} code ${k}` };
    }
  }
  // Sliding 60-frame windows over a sorted list: two pointers, one pass.
  let pressLo = 0;
  let anyLo = 0;
  let presses = 0;
  for (let hi = 0; hi < inputs.length; hi++) {
    const f = inputs[hi]![0];
    while (inputs[anyLo]![0] <= f - 60) anyLo++;
    if (hi - anyLo + 1 > MAX_INPUTS_PER_SEC) {
      return { error: 'INPUT_RATE_EXCEEDED', detail: `${hi - anyLo + 1} inputs in one second at frame ${f}` };
    }
    if (!PRESS_CODES.has(inputs[hi]![1])) continue;
    presses++;
    while (inputs[pressLo]![0] <= f - 60) {
      if (PRESS_CODES.has(inputs[pressLo]![1])) presses--;
      pressLo++;
    }
    if (presses > MAX_PRESSES_PER_SEC) {
      return { error: 'INPUT_RATE_EXCEEDED', detail: `${presses} presses in one second at frame ${f}` };
    }
  }
  return null;
}

/**
 * Replay a session from its seed and its button presses, and read off the score.
 *
 * This is the whole score-integrity story: the client never gets to report a number.
 * Deterministic, allocation-light, and single-digit milliseconds for a full 90 seconds —
 * cheap enough to run on every submission.
 */
export function runReplay(req: ReplayRequest): ReplayResult {
  if (req.engineVersion !== ENGINE_VERSION) {
    return fail('ENGINE_VERSION_MISMATCH', `tape ${req.engineVersion}, engine ${ENGINE_VERSION}`);
  }
  if (!isMapId(req.mapId) || !isCharId(req.charId)) {
    return fail('BAD_CONFIG', `map ${req.mapId}, char ${req.charId}`);
  }
  if (!Number.isInteger(req.seed) || req.seed < 0 || req.seed > 0x7fffffff) {
    return fail('BAD_CONFIG', `seed ${req.seed}`);
  }
  if (!Number.isFinite(req.handicap) || req.handicap < 0 || req.handicap > 1) {
    return fail('BAD_CONFIG', `handicap ${req.handicap}`);
  }

  const structural = validateTape(req.inputs);
  if (structural) return fail(structural.error, structural.detail);

  const sim = new Sim({
    seed: req.seed,
    mapId: req.mapId,
    charId: req.charId,
    handicap: req.handicap,
    engineVersion: req.engineVersion,
  });

  let cursor = 0;
  for (let f = 0; f < MAX_FRAMES && sim.mode !== 'ended'; f++) {
    while (cursor < req.inputs.length && req.inputs[cursor]![0] === f) {
      sim.applyInput(req.inputs[cursor]![1]);
      cursor++;
    }
    sim.step();
  }

  // A tape that keeps going after the run is over is either a bug or a forgery.
  if (cursor < req.inputs.length) {
    return fail(
      'INPUT_AFTER_END',
      `${req.inputs.length - cursor} inputs past frame ${sim.frame} (${sim.endReason ?? sim.mode})`,
    );
  }

  return {
    ok: true,
    score: sim.score,
    candles: sim.cleared,
    bestMult: sim.bestMult,
    cleanFlips: sim.cleanFlips,
    flips: sim.flips,
    pips: sim.pips,
    level: sim.level,
    frames: sim.frame,
    endReason: sim.endReason,
    inputJitterMs: inputJitterMs(req.inputs),
    inputCount: req.inputs.length,
    digest: digest(sim),
  };
}
