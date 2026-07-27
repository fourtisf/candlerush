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
const fs = require('node:fs');
const path = require('node:path');

/**
 * Ports chosen at deploy time and recorded by deploy/vps-deploy.sh.
 *
 * Read from a file rather than the environment so a `pm2 reload` months later cannot drift
 * away from the ports nginx is proxying to — a reload inherits whatever shell it was run
 * from, and that shell will not have the deploy's variables.
 */
function ports() {
  const out = { WEB_PORT: '3000', API_PORT: '4000' };
  try {
    for (const line of fs.readFileSync(path.join(__dirname, 'deploy', 'ports.env'), 'utf8').split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  } catch {
    // Not deployed by the script; the defaults are the documented ones.
  }
  return out;
}

const P = ports();

module.exports = {
  apps: [
    {
      name: 'candle-rush-api',
      cwd: './apps/api',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      // PORT here wins over apps/api/.env, which load-env.ts treats as defaults.
      env_production: { NODE_ENV: 'production', PORT: P.API_PORT },
      error_file: '../../logs/api.err.log',
      out_file: '../../logs/api.out.log',
      time: true,
    },
    {
      name: 'candle-rush-web',
      cwd: './apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env_production: { NODE_ENV: 'production', PORT: P.WEB_PORT },
      error_file: '../../logs/web.err.log',
      out_file: '../../logs/web.out.log',
      time: true,
    },
  ],
};
