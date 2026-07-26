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
 * Bump on ANY gameplay change: physics, generation, scoring, ordering of RNG draws.
 * Sessions record the version they were issued under and replays are rejected on
 * mismatch. A v1 tape replayed on a v2 engine produces garbage, and garbage that
 * silently becomes money is the worst failure this system has.
 */
export const ENGINE_VERSION = 1;

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

/** 90s at 60Hz. */
export const SESSION_FRAMES = Math.round(C.session / STEP);
/** The revive offer is a 6s countdown in the prototype; here it is 360 sim frames. */
export const REVIVE_SECONDS = 6;
export const REVIVE_FRAMES = Math.round(REVIVE_SECONDS / STEP);
/**
 * Upper bound on a legal tape. The handoff says 5,400; that is the session length and
 * ignores the revive offer, during which the session clock is frozen but frames still
 * advance (the camera drifts, exactly as in the prototype). 5,760 is the real ceiling.
 */
export const MAX_FRAMES = SESSION_FRAMES + REVIVE_FRAMES;

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
  { id: 'gem', name: 'Diamond', cost: 500000, col: '#8CF0FF', perk: 'Free stop loss every session.' },
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
