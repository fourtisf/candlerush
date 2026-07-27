import { randomInt } from 'node:crypto';
import {
  DEFAULT_STAKE,
  ENGINE_VERSION,
  STEP,
  stakeById,
  stakePayout,
  type CharId,
  type MapId,
} from '@candle-rush/engine';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { bump, k } from '../redis.js';
import {
  errorSchema,
  sessionAbandonBody,
  sessionAbandonReply,
  sessionStartBody,
  sessionStartReply,
  sessionSubmitBody,
  sessionSubmitReply,
} from '../schemas.js';
import { append, computeBalance, refreshBalanceCache, serializable } from '../services/ledger.js';
import * as lb from '../services/leaderboard.js';
import { nextHandicap, owns } from '../services/players.js';
import { ReplayTimeoutError, type AnyReplayPool } from '../services/replay-pool.js';
import { refundStake, refundStranded } from '../services/stakes.js';

/** The player cannot cover the stake they asked for. */
class NotEnoughForStake extends Error {
  constructor(readonly shortfall: number) {
    super('insufficient balance for stake');
  }
}

/**
 * How long an issued session stays open before it is written off as abandoned.
 *
 * Must not be shorter than the longest legal run, or a player deep in the ladder gets
 * their session expired out from under them mid-level and loses everything they banked.
 * It tracks the submit ceiling for exactly that reason.
 */
const openSessionWindowMs = (): number => env().SESSION_MAX_ELAPSED_MS;

/**
 * How far under its own simulated length a submission may sit before it is impossible.
 *
 * Slack for clock skew between the browser and this server, and for the seconds a session
 * spends being issued and posted. It is not slack for "the client ran the sim fast" —
 * nothing legitimate does that.
 */
const REAL_TIME_TOLERANCE = 0.85;

export function sessionRoutes(pool: AnyReplayPool): FastifyPluginAsync {
  return async (app) => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    const e = env();

    /**
     * Issue a session.
     *
     * The seed is generated here and only here. A client that picks its own seed can
     * shop for a favourable chart, and worse, can pre-compute a tape offline for a seed
     * it has known about for a week.
     */
    r.post(
      '/session/start',
      {
        preHandler: app.requireAuth,
        schema: {
          body: sessionStartBody,
          response: { 200: sessionStartReply, 403: errorSchema, 409: errorSchema, 429: errorSchema },
        },
      },
      async (req, reply) => {
        const player = req.player!;
        const { mapId, charId } = req.body;
        // An id, resolved against the server's own table. A cost that arrived in the body
        // would be a price the player set for themselves.
        const stake = stakeById(req.body.stakeId ?? DEFAULT_STAKE);
        if (!stake) {
          return reply.code(400).send({ error: 'NO_SUCH_STAKE', message: 'That is not a stake.' });
        }

        const perPlayer = await bump(k('rl', 'start', 'p', player.id), 3600);
        if (perPlayer > e.SESSION_START_PER_HOUR_PLAYER) {
          return reply.code(429).send({ error: 'RATE_LIMITED', message: 'Too many sessions this hour.' });
        }
        const perIp = await bump(k('rl', 'start', 'ip', req.ip), 3600);
        if (perIp > e.SESSION_START_PER_HOUR_IP) {
          return reply.code(429).send({ error: 'RATE_LIMITED', message: 'Too many sessions from this address.' });
        }

        // Do not trust the client's claim about what it owns.
        if (!owns(player, 'map', mapId) || !owns(player, 'char', charId)) {
          return reply.code(403).send({ error: 'NOT_UNLOCKED', message: 'You do not own that market or trader.' });
        }

        const cutoff = new Date(Date.now() - openSessionWindowMs());
        await prisma.session.updateMany({
          where: { playerId: player.id, status: 'OPEN', issuedAt: { lt: cutoff } },
          data: { status: 'EXPIRED' },
        });
        // Whatever just expired was holding a stake. Returning it here rather than on a
        // timer means the code that strands the money is the code that frees it.
        await refundStranded(player.id);

        const live = await prisma.session.findFirst({
          where: { playerId: player.id, status: 'OPEN', issuedAt: { gte: cutoff } },
          select: { id: true },
        });
        if (live) {
          return reply
            .code(409)
            .send({ error: 'SESSION_OPEN', message: 'Finish or abandon your open session first.', detail: live.id });
        }

        const seed = randomInt(0, 2 ** 31);
        let session;
        try {
          // One transaction, at serializable isolation, for the same reason the shop uses
          // one: the balance is re-derived from the rows inside it, so two concurrent
          // starts cannot stake the same money twice. Creating the session and debiting
          // for it together is what makes "a stake with no session" and "a session with no
          // stake" both impossible rather than merely unlikely.
          session = await serializable(async (tx) => {
            if (stake.cost > 0) {
              const balance = await computeBalance(player.id, tx);
              if (balance < stake.cost) throw new NotEnoughForStake(stake.cost - balance);
            }
            const created = await tx.session.create({
              data: {
                playerId: player.id,
                seed,
                mapId,
                charId,
                handicap: player.handicap,
                engineVersion: ENGINE_VERSION,
                stakeId: stake.id,
                stakeCost: stake.cost,
                stakeMult: stake.mult,
                stakeSettled: stake.cost === 0,
              },
            });
            if (stake.cost > 0) {
              await append(tx, {
                playerId: player.id,
                kind: 'SESSION_STAKE',
                amount: -stake.cost,
                refType: 'session',
                refId: created.id,
                memo: `${stake.name} stake`,
              });
            }
            return created;
          });
        } catch (err) {
          if (err instanceof NotEnoughForStake) {
            return reply.code(402).send({
              error: 'INSUFFICIENT_BALANCE',
              message: `You need ${err.shortfall.toLocaleString()} more to put up that stake.`,
            });
          }
          throw err;
        }

        // Remember the loadout so the hub is server-side state rather than a client claim.
        if (player.activeChar !== charId || player.activeMap !== mapId) {
          await prisma.player.update({ where: { id: player.id }, data: { activeChar: charId, activeMap: mapId } });
        }

        return {
          sessionId: session.id,
          seed,
          engineVersion: ENGINE_VERSION,
          config: {
            seed,
            mapId,
            charId,
            handicap: player.handicap,
            engineVersion: ENGINE_VERSION,
          },
          stake: { id: stake.id, name: stake.name, cost: stake.cost, mult: stake.mult },
          balance: await refreshBalanceCache(player.id),
          issuedAt: session.issuedAt.toISOString(),
        };
      },
    );

    /**
     * Give up on an open session.
     *
     * Without this, walking away from a run locks the player out for as long as the submit
     * window — half an hour, because a thirty-level run has to fit inside it. The stake
     * comes straight back, and the session can never be scored afterwards, so there is
     * nothing to farm here: the rate limit on issuing sessions is what bounds anyone
     * hunting for a favourable seed, and that limit is unaffected.
     */
    r.post(
      '/session/abandon',
      {
        preHandler: app.requireAuth,
        schema: {
          body: sessionAbandonBody,
          response: { 200: sessionAbandonReply, 404: errorSchema },
        },
        config: { rateLimit: { max: 40, timeWindow: '1 hour' } },
      },
      async (req, reply) => {
        const player = req.player!;
        const flipped = await prisma.session.updateMany({
          where: { id: req.body.sessionId, playerId: player.id, status: 'OPEN' },
          data: { status: 'ABANDONED', submittedAt: new Date() },
        });
        if (flipped.count === 0) {
          return reply.code(404).send({ error: 'NO_SESSION', message: 'No open session with that id.' });
        }
        const row = await prisma.session.findUniqueOrThrow({
          where: { id: req.body.sessionId },
          select: { id: true, playerId: true, stakeCost: true },
        });
        const refunded = await refundStake(row, 'stake returned — session abandoned');
        return { abandoned: true, refunded: refunded ? row.stakeCost : 0, balance: await refreshBalanceCache(player.id) };
      },
    );

    /**
     * Submit a tape.
     *
     * The body may carry a client score. It is written to the row and never read back
     * into anything — its only job is to make a determinism break visible before it
     * becomes a leaderboard dispute.
     */
    r.post(
      '/session/submit',
      {
        preHandler: app.requireAuth,
        schema: {
          body: sessionSubmitBody,
          response: {
            200: sessionSubmitReply,
            404: errorSchema,
            409: errorSchema,
            422: errorSchema,
            503: errorSchema,
          },
        },
        config: { rateLimit: { max: 40, timeWindow: '1 hour' } },
      },
      async (req, reply) => {
        const player = req.player!;
        const { sessionId, inputs, clientScore, clientDigest } = req.body;

        const session = await prisma.session.findUnique({ where: { id: sessionId } });
        if (!session || session.playerId !== player.id) {
          return reply.code(404).send({ error: 'NO_SESSION', message: 'Unknown session.' });
        }
        if (session.status !== 'OPEN') {
          return reply
            .code(409)
            .send({ error: 'ALREADY_SETTLED', message: 'That session has already been submitted.' });
        }

        const elapsed = Date.now() - session.issuedAt.getTime();
        const reject = async (code: string, message: string, detail?: string) => {
          await prisma.session.updateMany({
            where: { id: session.id, status: 'OPEN' },
            data: {
              status: 'REJECTED',
              submittedAt: new Date(),
              rejectReason: `${code}: ${detail ?? message}`,
              clientScore: clientScore ?? null,
              clientDigest: clientDigest ?? null,
              inputCount: inputs.length,
              wallClockMs: elapsed,
              replay: inputs as unknown as object,
            },
          });
          // A rejected tape gets its stake back. A rejection is not always the player's
          // doing — a wall-clock window set for the wrong game once rejected every run on
          // this box — and there is nothing to exploit: a payout needs a replay that
          // validates, so this returns the player's own money and nothing more.
          await refundStake(session, `stake returned — ${code}`);
          return reply.code(422).send({ error: code, message, detail });
        };

        // Too slow means they were computing. Too fast is checked below, against the tape.
        if (elapsed < e.SESSION_MIN_ELAPSED_MS) {
          return reject('TOO_FAST', 'That session finished faster than it can be played.', `${elapsed}ms`);
        }
        if (elapsed > e.SESSION_MAX_ELAPSED_MS) {
          return reject('TOO_SLOW', 'That session took too long to submit.', `${elapsed}ms`);
        }
        if (session.engineVersion !== ENGINE_VERSION) {
          return reject(
            'ENGINE_VERSION_MISMATCH',
            'The game was updated while you were playing. That session cannot be scored.',
            `session ${session.engineVersion}, server ${ENGINE_VERSION}`,
          );
        }

        let result;
        try {
          result = await pool.run({
            seed: session.seed,
            mapId: session.mapId as MapId,
            charId: session.charId as CharId,
            handicap: session.handicap,
            engineVersion: session.engineVersion,
            inputs,
          });
        } catch (err) {
          if (err instanceof ReplayTimeoutError) {
            return reject('REPLAY_TIMEOUT', 'That session could not be validated in time.');
          }
          req.log.error({ err, sessionId }, 'replay failed');
          return reply.code(503).send({ error: 'REPLAY_FAILED', message: 'Could not validate that session.' });
        }

        if (!result.ok) {
          return reject(result.error ?? 'INVALID_REPLAY', 'That session did not validate.', result.errorDetail);
        }

        // The real speed check, now that we know how long the run actually was.
        //
        // The simulation is a fixed 60Hz and the client's loop can fall behind wall clock
        // but never run ahead of it, so a tape of N frames took at least N/60 seconds to
        // produce on a real machine. A tape computed offline arrives with an elapsed time
        // that has nothing to do with its length, and that is what this catches. Deriving
        // the floor from the tape rather than fixing it in config is also what lets a
        // player who dies eight seconds into level one keep the money they earned.
        const simulatedMs = result.frames * STEP * 1000;
        if (elapsed < simulatedMs * REAL_TIME_TOLERANCE) {
          return reject(
            'TOO_FAST',
            'That session finished faster than it can be played.',
            `${elapsed}ms wall clock for ${Math.round(simulatedMs)}ms of play`,
          );
        }

        const score = result.score;
        // The leaderboard gets `score`; the wallet gets this. Rank stays a measure of
        // skill, and the stake only decides what that skill was worth to the player.
        const credited = stakePayout(score, session.stakeMult);
        const flagged = result.inputCount >= 8 && result.inputJitterMs < e.JITTER_FLAG_MS;

        if (clientScore !== undefined && clientScore !== score) {
          // Not a rejection. This is the canary for determinism drift, and it is supposed
          // to be loud: if it starts firing across many players, the engine has diverged.
          req.log.warn(
            { sessionId, clientScore, serverScore: score, clientDigest, serverDigest: result.digest },
            'client/server score mismatch',
          );
        }

        const settled = await prisma.$transaction(async (tx) => {
          // The status guard is the concurrency control: only one submission can flip a
          // session out of OPEN, so only one can reach the ledger write below.
          const flip = await tx.session.updateMany({
            where: { id: session.id, status: 'OPEN' },
            data: {
              status: 'SUBMITTED',
              submittedAt: new Date(),
              serverScore: score,
              clientScore: clientScore ?? null,
              clientDigest: clientDigest ?? null,
              serverDigest: result.digest,
              candles: result.candles,
              levelReached: result.level,
              bestMult: result.bestMult,
              cleanFlips: result.cleanFlips,
              inputCount: result.inputCount,
              inputJitterMs: result.inputJitterMs,
              frames: result.frames,
              endReason: result.endReason,
              wallClockMs: elapsed,
              replay: inputs as unknown as object,
            },
          });
          if (flip.count === 0) return null;

          if (credited > 0) {
            await append(tx, {
              playerId: player.id,
              kind: 'SESSION_PAYOUT',
              amount: credited,
              refType: 'session',
              refId: session.id,
              memo: session.stakeCost > 0 ? `${session.stakeId} stake, x${session.stakeMult}` : undefined,
            });
          }
          // Settled either way: a scored run converts its stake into the payout above, and
          // a zero-scoring run has spent it. Neither is eligible for a refund.
          await tx.session.updateMany({ where: { id: session.id }, data: { stakeSettled: true } });

          const updated = await tx.player.update({
            where: { id: player.id },
            data: {
              totalSessions: { increment: 1 },
              bestSession: score > player.bestSession ? score : undefined,
              handicap: nextHandicap(player.handicap, result.candles),
              flagged: flagged ? true : undefined,
            },
          });
          return updated;
        });

        if (!settled) {
          return reply
            .code(409)
            .send({ error: 'ALREADY_SETTLED', message: 'That session has already been submitted.' });
        }

        const balance = await refreshBalanceCache(player.id);
        if (score > 0) await lb.record(player.id, score);
        const [daily, alltime] = await Promise.all([
          lb.rankOf('daily', player.id),
          lb.rankOf('alltime', player.id),
        ]);

        if (flagged) {
          req.log.warn(
            { playerId: player.id, sessionId, jitter: result.inputJitterMs },
            'input timing looks automated — flagged for review, not banned',
          );
        }

        return {
          score,
          credited,
          stake: {
            id: session.stakeId,
            cost: session.stakeCost,
            mult: session.stakeMult,
            net: credited - session.stakeCost,
          },
          balance,
          best: settled.bestSession,
          isBest: score > player.bestSession,
          stats: {
            candles: result.candles,
            bestMult: result.bestMult,
            cleanFlips: result.cleanFlips,
            level: result.level,
            endReason: result.endReason,
          },
          rank: { daily: daily?.rank ?? null, alltime: alltime?.rank ?? null },
        };
      },
    );
  };
}
