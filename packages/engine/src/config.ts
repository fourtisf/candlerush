/**
 * Tuning, characters, markets, regimes — verbatim from the prototype.
 *
 * Every number here was tuned against a ~163,000 candle simulation. Do not change
 * anything in `C`, `CHARS`, `MAPS` or `REGIMES` without ALFA's sign-off. If a value
 * looks wrong, open an issue with the specific number and the reasoning.
 *
 * This module is the single source of truth for both the client (display) and the
 * server (enforcement). Prices in particular are read by the shop UI *and* by
 * `POST /shop/unlock`; there is exactly one copy so they cannot drift.
 */

/**
 * v2 replaced the single 90-second session with levels. v3 made DECLINE meaningful on the
 * level-clear panel — the "Back" button — which changes how an existing tape is
 * interpreted, not just what it looks like. Any tape recorded against an older version is
 * meaningless here and is rejected on submit.
 *
 * Bump on ANY gameplay change: physics, generation, scoring, ordering of RNG draws, or
 * the meaning of an input code. Sessions record the version they were issued under and
 * replays are rejected on mismatch. An old tape replayed on a new engine produces
 * garbage, and garbage that silently becomes money is the worst failure this system has.
 */
export const ENGINE_VERSION = 3;

/**
 * Fixed virtual viewport.
 *
 * NOT in the prototype, and load-bearing. The prototype generates the world in terms
 * of the live canvas size (`H*.55`, `H*.22`, `H*.76`, `cam+W+600`, `P.x-W*C.px`), so
 * two players on different screens get different charts from the same seed — and the
 * server, which has no screen at all, could not reproduce either. The simulation
 * therefore runs at a fixed 1280x720 and the renderer scales that band onto whatever
 * canvas it has. See docs/SCORE-INTEGRITY.md §"Viewport".
 */
export const VIEW = { w: 1280, h: 720 } as const;

/** Fixed simulation timestep. Rendering may interpolate; the sim never sees wall clock. */
export const STEP = 1 / 60;

export const C = {
  pitch: 68,
  cw: 57,
  grav: 2300,
  jumpV: 790,
  cut: 0.42,
  pw: 30,
  ph: 34,
  coyote: 0.18,
  buffer: 0.2,
  step: 24,
  land: 22,
  magnet: 42,
  spd0: 232,
  spdMax: 470,
  ramp: 1.15,
  px: 0.26,
  session: 90,
  bell: 20,
  warm: 26,
} as const;

/** Peak jump height, 135.67px. */
export const JH = C.jumpV ** 2 / (2 * C.grav);
/** Time from launch back to launch height, 0.687s. */
export const AIRTIME = (2 * C.jumpV) / C.grav;

/**
 * Levels.
 *
 * The prototype was a single 90-second session that ramped gently. A run is now a ladder
 * of short levels that each end in a hard stop, and every level is measurably faster,
 * gappier and more flip-dense than the one before. Dying ends the run; surviving a level
 * banks it and raises the payout.
 *
 * `seconds` is the knob to turn if levels feel long or short — everything below is
 * derived from it, including the frame budget and the API's wall-clock window.
 */
export const LEVEL = {
  /** Length of one level. */
  seconds: 25,
  /** The level-clear panel. Counts down and continues on its own so a tape cannot stall. */
  breakSeconds: 8,
  /** Closing bell inside each level: the last few seconds pay double. */
  bell: 5,
  /** Ceiling, so a tape has a bounded length. Reaching it clears the run. */
  maxLevels: 15,
} as const;

export const LEVEL_FRAMES = Math.round(LEVEL.seconds / STEP);
export const BREAK_FRAMES = Math.round(LEVEL.breakSeconds / STEP);

/** The revive offer is a 6s countdown in the prototype; here it is 360 sim frames. */
export const REVIVE_SECONDS = 6;
export const REVIVE_FRAMES = Math.round(REVIVE_SECONDS / STEP);

/**
 * Upper bound on a legal tape: every level plus every break, plus one revive offer.
 * The handoff's 5,400 was the old single session and no longer applies.
 */
export const MAX_FRAMES = LEVEL.maxLevels * (LEVEL_FRAMES + BREAK_FRAMES) + REVIVE_FRAMES;

/* ── difficulty per level ───────────────────────────────────────────────────
 *
 * Speed is the primary knob because it tightens reaction time without making any single
 * jump impossible — a faster player clears a gap more easily, not less, so the generator's
 * "every gap is crossable" invariant survives the ramp untouched.
 *
 * Gap frequency and trend length are secondary: more holes to cross, and shorter trends
 * so the tape demands more flips per minute. Doji bridges are never shortened; three
 * candles is the floor at which a flip is readable, and taking that away makes the game
 * unfair rather than hard.
 */

/** Starting speed multiplier for a level. */
export const levelSpeedStart = (level: number): number => 1 + 0.1 * (level - 1);
/** Ceiling speed multiplier for a level. */
export const levelSpeedMax = (level: number): number => 1 + 0.08 * (level - 1);
/** Gap frequency multiplier. The resulting probability is clamped in the generator. */
export const levelGapMul = (level: number): number => 1 + 0.15 * (level - 1);
/** Trend-length multiplier: shorter runs mean more forced flips. Floored so trends stay readable. */
export const levelRunMul = (level: number): number => Math.max(0.5, 1 - 0.06 * (level - 1));
/** Payout multiplier. Surviving deeper is where the money is. */
export const levelPay = (level: number): number => 1 + 0.25 * (level - 1);
/** Hard ceiling on gap probability, whatever the level multiplier works out to. */
export const MAX_GAP_CHANCE = 0.35;

/**
 * Generation horizon and cull distance. Constants, not viewport-derived: a wider screen
 * must not generate more world. Both are generous enough for a 21:9 canvas.
 * Changing them cannot change the candle sequence — generation only ever reads the
 * previous candle and the RNG — so they are safe to widen without a version bump.
 */
export const LOOKAHEAD = 2600;
export const CULL_BEHIND = 600;

/** Minimum candles cleared before the revive offer is available. */
export const REVIVE_MIN_CLEARED = 12;

export type CharId = 'bull' | 'bear' | 'fox' | 'whale' | 'ape' | 'gem';
export type MapId = 'dawn' | 'night' | 'red' | 'gold';
export type RegimeId = 'drift' | 'breakout' | 'selloff' | 'chop';
export type CandleKind = 'green' | 'red' | 'doji';
export type PowerKind = 'lev' | 'shield' | 'bull';

export interface CharDef {
  id: CharId;
  name: string;
  cost: number;
  col: string;
  perk: string;
}

export interface MapDef {
  id: MapId;
  name: string;
  cost: number;
  pay: number;
  spd: number;
  tier: number;
  note: string;
  longOnly?: boolean;
  bg: 'hills' | 'city' | 'peaks' | 'dunes';
  amb: 'spark' | 'ash' | 'mote' | null;
  chop?: number;
  bias?: 'red';
  rich?: boolean;
  /** [night, day] each a 4-stop gradient. Cosmetic, but lives here so the shop can paint it. */
  sky: [number[][], number[][]];
}

export interface RegimeDef {
  n: string;
  run: [number, number];
  slope: [number, number];
  gap: number;
  spd: number;
  force?: CandleKind;
}

export const CHARS: readonly CharDef[] = [
  { id: 'bull', name: 'Bull', cost: 0, col: '#22E6A0', perk: 'Steady. Nothing special.' },
  { id: 'bear', name: 'Bear', cost: 20000, col: '#FF4A6B', perk: 'Opens every session short.' },
  { id: 'fox', name: 'Fox', cost: 50000, col: '#FF9A4D', perk: 'Market speeds up 30% slower.' },
  { id: 'whale', name: 'Whale', cost: 120000, col: '#6FB4FF', perk: 'Double pip reach, +30% value.' },
  { id: 'ape', name: 'Ape', cost: 250000, col: '#C08CFF', perk: 'A third jump in the air.' },
  { id: 'gem', name: 'Diamond', cost: 500000, col: '#8CF0FF', perk: 'Starts every session hedged.' },
] as const;

export const MAPS: readonly MapDef[] = [
  {
    id: 'dawn',
    name: 'Dawn',
    cost: 0,
    pay: 1.0,
    spd: 1.0,
    tier: 1,
    longOnly: true,
    bg: 'hills',
    amb: null,
    note: 'Long only. No shorting, no holes. Learn the tape.',
    sky: [
      [
        [8, 11, 36],
        [27, 24, 64],
        [74, 42, 85],
        [140, 74, 82],
      ],
      [
        [18, 36, 94],
        [58, 78, 158],
        [196, 112, 138],
        [255, 184, 112],
      ],
    ],
  },
  {
    id: 'night',
    name: 'Night',
    cost: 40000,
    pay: 1.3,
    spd: 1.06,
    tier: 2,
    bg: 'city',
    amb: 'spark',
    chop: 1.0,
    note: 'Shorting opens up. Calm trends, long doji bridges.',
    sky: [
      [
        [4, 6, 20],
        [12, 14, 44],
        [28, 22, 70],
        [52, 34, 96],
      ],
      [
        [10, 16, 52],
        [26, 32, 96],
        [70, 44, 140],
        [132, 72, 190],
      ],
    ],
  },
  {
    id: 'red',
    name: 'Red Sea',
    cost: 150000,
    pay: 1.6,
    spd: 1.1,
    tier: 3,
    bg: 'peaks',
    amb: 'ash',
    chop: 1.3,
    bias: 'red',
    note: 'Bleeding tape. You will live in short.',
    sky: [
      [
        [26, 6, 16],
        [58, 12, 30],
        [96, 22, 40],
        [140, 38, 48],
      ],
      [
        [62, 14, 28],
        [122, 30, 48],
        [190, 58, 66],
        [246, 116, 96],
      ],
    ],
  },
  {
    id: 'gold',
    name: 'Gold Rush',
    cost: 400000,
    pay: 2.0,
    spd: 1.18,
    tier: 4,
    bg: 'dunes',
    amb: 'mote',
    chop: 1.6,
    rich: true,
    note: 'Melt-up. Fast, choppy, pip-rich.',
    sky: [
      [
        [36, 20, 6],
        [74, 44, 14],
        [122, 76, 22],
        [168, 110, 34],
      ],
      [
        [92, 52, 12],
        [168, 110, 30],
        [228, 164, 52],
        [255, 214, 120],
      ],
    ],
  },
] as const;

export const REGIMES: Record<RegimeId, RegimeDef> = {
  drift: { n: 'DRIFT', run: [20, 30], slope: [-40, 44], gap: 0.09, spd: 1.0 },
  breakout: { n: 'BREAKOUT', run: [26, 36], slope: [-58, -14], gap: 0.04, spd: 1.12, force: 'green' },
  selloff: { n: 'SELL-OFF', run: [26, 36], slope: [20, 62], gap: 0.04, spd: 1.12, force: 'red' },
  chop: { n: 'CHOP', run: [11, 15], slope: [-30, 32], gap: 0.13, spd: 0.94 },
};

export const DEFAULT_CHAR: CharId = 'bull';
export const DEFAULT_MAP: MapId = 'dawn';

export function charById(id: string | undefined): CharDef {
  return CHARS.find((c) => c.id === id) ?? CHARS[0]!;
}

export function mapById(id: string | undefined): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0]!;
}

export function isCharId(id: string): id is CharId {
  return CHARS.some((c) => c.id === id);
}

export function isMapId(id: string): id is MapId {
  return MAPS.some((m) => m.id === id);
}

/** Price lookup used by the shop. Server-side only source of truth for `POST /shop/unlock`. */
export function priceOf(itemId: string): { kind: 'char' | 'map'; cost: number; name: string } | null {
  const c = CHARS.find((x) => x.id === itemId);
  if (c) return { kind: 'char', cost: c.cost, name: c.name };
  const m = MAPS.find((x) => x.id === itemId);
  if (m) return { kind: 'map', cost: m.cost, name: m.name };
  return null;
}
