/**
 * PM2 process definitions for the Hostinger VPS.
 *
 * Deploy is: pull, `pnpm install --frozen-lockfile`, `pnpm build`,
 * `pnpm --filter @candle-rush/api exec prisma migrate deploy`, then
 * `pm2 reload ecosystem.config.cjs --env production`.
 *
 * The API is forked rather than clustered on purpose. Replays already run in their own
 * worker threads, and clustering would multiply the Redis and Postgres connection count for
 * a workload that is not CPU-bound at the HTTP layer. Raise `instances` if profiling
 * disagrees — nothing in the API holds process-local state that would break.
 */
module.exports = {
  apps: [
    {
      name: 'candle-rush-api',
      cwd: './apps/api',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env_production: { NODE_ENV: 'production' },
      error_file: '../../logs/api.err.log',
      out_file: '../../logs/api.out.log',
      time: true,
    },
    {
      name: 'candle-rush-web',
      cwd: './apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env_production: { NODE_ENV: 'production' },
      error_file: '../../logs/web.err.log',
      out_file: '../../logs/web.out.log',
      time: true,
    },
  ],
};
