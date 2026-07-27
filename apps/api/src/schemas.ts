import { CHARS, ENGINE_VERSION, MAPS, MAX_FRAMES, MAX_INPUTS, STAKES } from '@candle-rush/engine';
import { z } from 'zod';

/**
 * Every request and response body on this API is validated here. No exceptions — an
 * unvalidated body is an unvalidated claim, and some of these claims are about money.
 */

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'not an ethereum address')
  .transform((s) => s.toLowerCase());

export const charIdSchema = z.enum(CHARS.map((c) => c.id) as [string, ...string[]]);
export const mapIdSchema = z.enum(MAPS.map((m) => m.id) as [string, ...string[]]);

export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(14)
  .regex(/^[\p{L}\p{N} ._-]+$/u, 'letters, numbers, space, dot, underscore and dash only')
  .transform((s) => s.toUpperCase());

/** `[frame, code]` pairs, exactly as the engine records them. */
export const inputEventSchema = z.tuple([
  z.number().int().min(0).max(MAX_FRAMES - 1),
  z.number().int().min(0).max(5),
]);

export const inputTapeSchema = z.array(inputEventSchema).max(MAX_INPUTS);

export const playerSchema = z.object({
  id: z.string(),
  address: z.string(),
  name: z.string(),
  /** False while the name is still the placeholder the server assigned at sign-in. */
  named: z.boolean(),
  playStreak: z.number().int(),
  bestStreak: z.number().int(),
  activeChar: z.string(),
  activeMap: z.string(),
  unlockedChars: z.array(z.string()),
  unlockedMaps: z.array(z.string()),
  bestSession: z.number().int(),
  totalSessions: z.number().int(),
  flagged: z.boolean(),
  createdAt: z.string(),
});

export const errorSchema = z.object({
  error: z.string(),
  message: z.string(),
  detail: z.string().optional(),
});

/* ── auth ──────────────────────────────────────────────────────────────────── */

export const nonceBody = z.object({ address: addressSchema });
export const nonceReply = z.object({ nonce: z.string(), issuedAt: z.string() });

export const verifyBody = z.object({
  message: z.string().min(1).max(4000),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});
export const verifyReply = z.object({
  token: z.string(),
  player: playerSchema,
  balance: z.number().int(),
});

/* ── me ────────────────────────────────────────────────────────────────────── */

export const meReply = z.object({
  player: playerSchema,
  balance: z.number().int(),
});

export const nameBody = z.object({ name: nameSchema });

export const migrateGuestBody = z.object({ balance: z.number().int().nonnegative() });

/* ── session ───────────────────────────────────────────────────────────────── */

export const stakeIdSchema = z.enum(STAKES.map((s) => s.id) as [string, ...string[]]);

export const sessionStartBody = z.object({
  mapId: mapIdSchema,
  charId: charIdSchema,
  /** An id, never an amount. The cost and the multiplier are the server's to decide. */
  stakeId: stakeIdSchema.optional(),
});

export const sessionStartReply = z.object({
  sessionId: z.string(),
  seed: z.number().int(),
  engineVersion: z.number().int(),
  config: z.object({
    seed: z.number().int(),
    mapId: z.string(),
    charId: z.string(),
    handicap: z.number(),
    engineVersion: z.number().int(),
  }),
  stake: z.object({
    id: z.string(),
    name: z.string(),
    cost: z.number().int(),
    mult: z.number(),
  }),
  balance: z.number().int(),
  issuedAt: z.string(),
});

export const sessionAbandonBody = z.object({ sessionId: z.string().min(1).max(64) });
export const sessionAbandonReply = z.object({
  abandoned: z.boolean(),
  refunded: z.number().int(),
  balance: z.number().int(),
});

export const sessionSubmitBody = z.object({
  sessionId: z.string().min(1).max(64),
  inputs: inputTapeSchema,
  /** Logged so drift can be detected. Never used to compute anything. */
  clientScore: z.number().int().nonnegative().max(1_000_000_000).optional(),
  clientDigest: z.string().max(64).optional(),
});

export const sessionSubmitReply = z.object({
  /** What the run was worth on its own. This is the leaderboard number. */
  score: z.number().int(),
  /** What it paid, after the stake multiplier. */
  credited: z.number().int(),
  stake: z.object({
    id: z.string(),
    cost: z.number().int(),
    mult: z.number(),
    /** credited − cost. Negative when the run did not clear its own stake. */
    net: z.number().int(),
  }),
  balance: z.number().int(),
  best: z.number().int(),
  isBest: z.boolean(),
  stats: z.object({
    candles: z.number().int(),
    bestMult: z.number().int(),
    cleanFlips: z.number().int(),
    level: z.number().int(),
    endReason: z.string().nullable(),
  }),
  rank: z.object({
    daily: z.number().int().nullable(),
    alltime: z.number().int().nullable(),
  }),
});

/* ── shop ──────────────────────────────────────────────────────────────────── */

export const unlockBody = z.object({ itemId: z.string().min(1).max(32) });
export const unlockReply = z.object({
  player: playerSchema,
  balance: z.number().int(),
  spent: z.number().int(),
});

/* ── leaderboard ───────────────────────────────────────────────────────────── */

export const leaderboardQuery = z.object({
  window: z.enum(['daily', 'weekly', 'alltime']).default('daily'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const leaderboardEntry = z.object({
  rank: z.number().int(),
  playerId: z.string(),
  name: z.string(),
  score: z.number().int(),
  charId: z.string(),
  mapId: z.string(),
});

export const podiumSchema = z.object({
  day: z.string(),
  entrants: z.number().int(),
  paid: z.number().int(),
  results: z.array(
    z.object({
      rank: z.number().int(),
      playerId: z.string(),
      name: z.string(),
      score: z.number().int(),
      prize: z.number().int(),
    }),
  ),
});

export const leaderboardReply = z.object({
  window: z.string(),
  entries: z.array(leaderboardEntry),
  me: leaderboardEntry.nullable(),
  /** The last settled day, so the reset is an event rather than a board going blank. */
  yesterday: podiumSchema.nullable(),
});

export const healthReply = z.object({
  ok: z.boolean(),
  engineVersion: z.literal(ENGINE_VERSION),
  db: z.boolean(),
  redis: z.boolean(),
});
