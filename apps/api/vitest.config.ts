import { defineConfig } from 'vitest/config';

/**
 * Integration tests need a Postgres and a Redis. Point these at throwaway instances —
 * `reset()` truncates every table between tests, so never aim them at anything real.
 */
export default defineConfig({
  test: {
    // Serial: the suite shares one database and flushes it between tests.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://candlerush@127.0.0.1:55432/candlerush_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379/1',
      JWT_SECRET: 'test-secret-that-is-definitely-long-enough-32',
      COOKIE_SECURE: 'false',
      SIWE_DOMAIN: 'localhost:3000',
      SIWE_URI: 'http://localhost:3000',
      RHC_CHAIN_ID: '31337',
      REPLAY_INLINE: '1',
    },
  },
});
