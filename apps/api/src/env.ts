import { z } from 'zod';

/**
 * Everything the API needs from its environment, validated once at boot.
 *
 * Nothing here has a "sensible default" that would be dangerous if it were wrong in
 * production — no default JWT secret, no default database, no default chain id.
 */
/**
 * A key that is present but blank in a .env file means "not set".
 *
 * `RHC_RPC_URL=` is the normal way to write an unset value, and it is exactly what
 * deploy/vps-deploy.sh writes when no RPC URL was supplied. Zod's `.optional()` only
 * accepts `undefined`, so an empty string went to `.url()` and failed — and because this
 * validation runs at import time, the API did not start at all. It restarted, failed,
 * restarted, failed, and the only symptom anywhere else was a site with no API behind it.
 *
 * Blank means absent. Anything else is a value and is validated as one.
 */
const blankIsUnset = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), inner);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),

  /** Signing key for the session JWT. Rotate and every cookie becomes invalid, which is the point. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_NAME: z.string().default('cr_session'),
  COOKIE_DOMAIN: blankIsUnset(z.string().optional()),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Origins allowed to send credentialed requests. Comma separated. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  /** The domain a SIWE message must claim. A message for another domain is a replay from another site. */
  SIWE_DOMAIN: z.string().min(1),
  SIWE_URI: z.string().url(),
  SIWE_STATEMENT: z.string().default('Sign in to Candle Rush.'),

  /**
   * Robinhood Chain. Deliberately has no default: the handoff says to take the chain id
   * and RPC from https://docs.robinhood.com/chain rather than from memory, and a wrong
   * chain id silently accepts signatures meant for a different network.
   */
  RHC_CHAIN_ID: z.coerce.number().int().positive(),
  RHC_RPC_URL: blankIsUnset(z.string().url().optional()),

  /** Replay guard rails. */
  /**
   * The ceiling covers the whole ladder plus its between-level panels — the old 300s would
   * reject every deep run.
   *
   * The floor is deliberately small. It is only a cheap pre-replay filter for a body that
   * arrives the same second the session was issued; the real "too fast" test is
   * frame-derived and lives in the submit route, because a run's honest duration is
   * whatever the tape actually simulated. A flat floor cannot know that, and a flat floor
   * high enough to be worth anything rejects the most ordinary outcome in the game: dying
   * ten seconds into level one.
   */
  SESSION_MIN_ELAPSED_MS: z.coerce.number().int().positive().default(2_000),
  SESSION_MAX_ELAPSED_MS: z.coerce.number().int().positive().default(1_800_000),
  /**
   * A full-length run is 59,760 frames. Warm, that replays in about 150ms; the first
   * replay on a cold worker measured 750ms while the JIT caught up. The ceiling is set
   * well clear of that because the failure mode is rejecting a legitimate thirty-level
   * run, which is a far worse outcome than holding a worker for an extra second.
   */
  REPLAY_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  REPLAY_WORKERS: z.coerce.number().int().positive().max(16).default(2),

  /**
   * Enables GET /admin/stats. Unset, the endpoint answers 501 rather than existing with a
   * default token — a guessable admin door is worse than no door.
   */
  ADMIN_TOKEN: blankIsUnset(z.string().min(24).optional()),

  /** Rate limits. */
  SESSION_START_PER_HOUR_PLAYER: z.coerce.number().int().positive().default(20),
  SESSION_START_PER_HOUR_IP: z.coerce.number().int().positive().default(60),

  /** Below this stddev (ms) an account is flagged for review. Never auto-banned. */
  JITTER_FLAG_MS: z.coerce.number().nonnegative().default(8),

  /** One-time guest balance migration ceiling. */
  GUEST_MIGRATION_CAP: z.coerce.number().int().nonnegative().default(50_000),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  if (parsed.data.SESSION_MIN_ELAPSED_MS >= parsed.data.SESSION_MAX_ELAPSED_MS) {
    throw new Error('SESSION_MIN_ELAPSED_MS must be below SESSION_MAX_ELAPSED_MS');
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

export const corsOrigins = (e: Env): string[] =>
  e.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
