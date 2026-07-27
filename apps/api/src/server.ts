import { ENGINE_VERSION } from '@candle-rush/engine';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { prisma } from './db.js';
import { corsOrigins, env } from './env.js';
import { authPlugin } from './plugins/auth.js';
import { NS, redis } from './redis.js';
import { authRoutes } from './routes/auth.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { meRoutes } from './routes/me.js';
import { sessionRoutes } from './routes/session.js';
import { shopRoutes } from './routes/shop.js';
import { createReplayPool, type AnyReplayPool } from './services/replay-pool.js';

export interface BuiltServer {
  app: FastifyInstance;
  pool: AnyReplayPool;
}

export async function buildServer(pool: AnyReplayPool = createReplayPool()): Promise<BuiltServer> {
  const e = env();
  const app = Fastify({
    logger:
      e.NODE_ENV === 'test'
        ? false
        : e.NODE_ENV === 'production'
          ? { level: 'info' }
          : { level: 'debug', transport: { target: 'pino-pretty' } },
    trustProxy: true,
    bodyLimit: 512 * 1024, // a tape is a few KB; nothing legitimate comes near this
    disableRequestLogging: e.NODE_ENV === 'production',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: corsOrigins(e), credentials: true });
  await app.register(rateLimit, {
    global: false,
    redis: redis(),
    // Same reason as every other key here: this instance may not be ours alone.
    nameSpace: `${NS}rl:fastify:`,
    keyGenerator: (req) => `${req.ip}`,
  });
  await app.register(authPlugin);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError || (err as { validation?: unknown }).validation) {
      return reply.code(400).send({
        error: 'INVALID_REQUEST',
        message: 'That request did not match the expected shape.',
        detail: err.message,
      });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply.code(status).send({
      error: status >= 500 ? 'INTERNAL' : 'REQUEST_FAILED',
      message: status >= 500 ? 'Something went wrong on our side.' : err.message,
    });
  });

  app.get('/health', async () => {
    const [db, r] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis().ping()]);
    return {
      ok: db.status === 'fulfilled' && r.status === 'fulfilled',
      engineVersion: ENGINE_VERSION,
      db: db.status === 'fulfilled',
      redis: r.status === 'fulfilled',
    };
  });

  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(sessionRoutes(pool));
  await app.register(shopRoutes);
  await app.register(leaderboardRoutes);

  void jsonSchemaTransform; // kept for when OpenAPI docs are wired up

  return { app, pool };
}
