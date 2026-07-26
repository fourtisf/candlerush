import { Redis } from 'ioredis';
import { env } from './env.js';

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
