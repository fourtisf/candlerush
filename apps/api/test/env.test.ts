import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

/**
 * The environment is validated at import time, so a mistake here is not a bad request —
 * it is an API that never starts. It restarts, fails, restarts, and the only symptom
 * anywhere else is a site with nothing behind it.
 */

/** Exactly what deploy/vps-deploy.sh writes, blanks and all. */
const asDeployed = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://candlerush@127.0.0.1:5433/candlerush',
  REDIS_URL: 'redis://127.0.0.1:6379/3',
  JWT_SECRET: 'x'.repeat(64),
  SIWE_DOMAIN: 'candlerush.fun',
  SIWE_URI: 'https://candlerush.fun',
  RHC_CHAIN_ID: '42161',
  // `RHC_RPC_URL=${RHC_RPC_URL:-}` with nothing supplied writes exactly this line.
  RHC_RPC_URL: '',
  ...over,
});

describe('the environment', () => {
  it('reads a blank optional as unset rather than refusing to start', () => {
    // This exact line took the production API down: an empty string is not `undefined`,
    // so it went to .url() and failed, and the process died on import.
    const e = loadEnv(asDeployed());
    expect(e.RHC_RPC_URL).toBeUndefined();
    expect(e.RHC_CHAIN_ID).toBe(42161);
  });

  it('treats every optional the same way', () => {
    const e = loadEnv(asDeployed({ COOKIE_DOMAIN: '', ADMIN_TOKEN: '   ' }));
    expect(e.COOKIE_DOMAIN).toBeUndefined();
    expect(e.ADMIN_TOKEN).toBeUndefined();
  });

  it('still validates a value that is actually there', () => {
    expect(() => loadEnv(asDeployed({ RHC_RPC_URL: 'not-a-url' }))).toThrow(/RHC_RPC_URL/);
    expect(() => loadEnv(asDeployed({ ADMIN_TOKEN: 'too-short' }))).toThrow(/ADMIN_TOKEN/);
    expect(loadEnv(asDeployed({ RHC_RPC_URL: 'https://rpc.example' })).RHC_RPC_URL).toBe(
      'https://rpc.example',
    );
  });

  it('still refuses the things that must never be guessed', () => {
    expect(() => loadEnv(asDeployed({ JWT_SECRET: 'short' }))).toThrow(/JWT_SECRET/);
    expect(() => loadEnv(asDeployed({ RHC_CHAIN_ID: '' }))).toThrow(/RHC_CHAIN_ID/);
    expect(() => loadEnv(asDeployed({ DATABASE_URL: '' }))).toThrow(/DATABASE_URL/);
  });

  it('keeps the replay window wide enough for the longest legal run', () => {
    // A thirty-level ladder is 990 seconds of play. A ceiling below that rejects exactly
    // the players who earned the most, and has now done so twice.
    const e = loadEnv(asDeployed());
    expect(e.SESSION_MAX_ELAPSED_MS).toBeGreaterThan(990_000);
    expect(e.SESSION_MIN_ELAPSED_MS).toBeLessThan(e.SESSION_MAX_ELAPSED_MS);
  });
});
