// Must be first: it populates process.env before any module reads it.
import './load-env.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { closeRedis } from './redis.js';
import { buildServer } from './server.js';

const e = env();
const { app, pool } = await buildServer();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await pool.close();
    await prisma.$disconnect();
    await closeRedis();
  } finally {
    process.exit(0);
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void shutdown(sig));
}

try {
  await app.listen({ port: e.PORT, host: e.HOST });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
