import { Redis } from 'ioredis';
import { env } from './env.js';

/**
 * Namespace for every key this service owns.
 *
 * Redis is frequently shared. `lb:`, `player:`, `rl:` and `siwe:` are all generic enough
 * that a co-hosted app could plausibly be using them — `rl:` in particular is the
 * conventional rate-limiter prefix — and an operator clearing "our" keys by pattern would
 * take that app's data with them.
 *
 * Applied explicitly rather than through ioredis's `keyPrefix` option, because keyPrefix
 * is documented not to apply to the keys passed to EVAL, and the SIWE nonce is consumed
 * with a Lua script. Half-prefixed keys would mean nonces that can never be found.
 */
export const NS = 'cr:';
export const k = (...parts: string[]): string => NS + parts.join(':');

let client: Redis | null = null;

export function redis(): Redis {
  client ??= new Redis(env().REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

/**
 * Fixed-window counter. Crude on purpose: the sliding-window version costs a sorted set
 * per key and buys nothing here, because the limits are per hour and the abuse we care
 * about is measured in thousands of requests, not in burst shape.
 */
export async function bump(key: string, ttlSeconds: number): Promise<number> {
  const r = redis();
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, ttlSeconds);
  return n;
}
