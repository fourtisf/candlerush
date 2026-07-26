import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { Player } from '@prisma/client';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '../db.js';
import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyRequest {
    player?: Player;
  }
  interface FastifyInstance {
    /** Rejects unless the caller holds a valid, unbanned session. Attaches `req.player`. */
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Attaches `req.player` when there is one, but lets guests through. */
    optionalAuth: (req: FastifyRequest) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; addr: string };
    user: { sub: string; addr: string };
  }
}

export const authPlugin: FastifyPluginAsync = fp(async (app) => {
  const e = env();

  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: e.JWT_SECRET,
    sign: { expiresIn: `${e.JWT_TTL_DAYS}d` },
    cookie: { cookieName: e.COOKIE_NAME, signed: false },
  });

  async function load(req: FastifyRequest): Promise<Player | null> {
    try {
      // Reads the cookie first, then falls back to a bearer header for non-browser callers.
      await req.jwtVerify();
    } catch {
      return null;
    }
    const id = req.user?.sub;
    if (!id) return null;
    const player = await prisma.player.findUnique({ where: { id } });
    return player ?? null;
  }

  app.decorate('optionalAuth', async (req: FastifyRequest) => {
    const player = await load(req);
    if (player && !player.banned) req.player = player;
  });

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    const player = await load(req);
    if (!player) {
      await reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sign in with your wallet first.' });
      return;
    }
    if (player.banned) {
      await reply.code(403).send({ error: 'BANNED', message: 'This account is suspended.' });
      return;
    }
    req.player = player;
  });
});

export function setSessionCookie(reply: FastifyReply, token: string): void {
  const e = env();
  reply.setCookie(e.COOKIE_NAME, token, {
    httpOnly: true,
    secure: e.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    domain: e.COOKIE_DOMAIN,
    maxAge: e.JWT_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(env().COOKIE_NAME, { path: '/', domain: env().COOKIE_DOMAIN });
}
