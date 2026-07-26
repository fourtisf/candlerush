import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Hex } from 'viem';
import { clearSessionCookie, setSessionCookie } from '../plugins/auth.js';
import { errorSchema, nonceBody, nonceReply, verifyBody, verifyReply } from '../schemas.js';
import { balanceOf } from '../services/ledger.js';
import { findOrCreateByAddress, publicPlayer } from '../services/players.js';
import { SiweError, issueNonce, verifySiwe } from '../services/siwe.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/auth/nonce',
    {
      schema: { body: nonceBody, response: { 200: nonceReply, 400: errorSchema } },
      config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
    },
    async (req) => {
      const nonce = await issueNonce(req.body.address);
      return { nonce, issuedAt: new Date().toISOString() };
    },
  );

  r.post(
    '/auth/verify',
    {
      schema: { body: verifyBody, response: { 200: verifyReply, 401: errorSchema } },
      config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
    },
    async (req, reply) => {
      let address: string;
      try {
        address = await verifySiwe(req.body.message, req.body.signature as Hex);
      } catch (err) {
        if (err instanceof SiweError) {
          return reply.code(401).send({ error: err.code, message: err.message });
        }
        throw err;
      }

      const player = await findOrCreateByAddress(address);
      if (player.banned) {
        return reply.code(403).send({ error: 'BANNED', message: 'This account is suspended.' });
      }
      const token = app.jwt.sign({ sub: player.id, addr: player.address });
      setSessionCookie(reply, token);
      return { token, player: publicPlayer(player), balance: await balanceOf(player.id) };
    },
  );

  r.post('/auth/logout', { schema: { response: { 200: nonceReply.pick({ issuedAt: true }) } } }, async (_req, reply) => {
    clearSessionCookie(reply);
    return { issuedAt: new Date().toISOString() };
  });
};
