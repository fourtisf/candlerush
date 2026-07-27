import type { CharId, InputEvent, MapId, SessionConfig } from '@candle-rush/engine';

/**
 * Typed client for the Fastify API.
 *
 * Credentials are always included: the session lives in an httpOnly cookie, which is the
 * point — a token the page can read is a token an injected script can steal.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = (body ?? {}) as { error?: string; message?: string; detail?: string };
    throw new ApiError(res.status, e.error ?? 'UNKNOWN', e.message ?? res.statusText, e.detail);
  }
  return body as T;
}

const post = <T>(path: string, payload?: unknown): Promise<T> =>
  call<T>(path, { method: 'POST', body: payload === undefined ? undefined : JSON.stringify(payload) });

export interface PlayerDto {
  id: string;
  address: string;
  name: string;
  activeChar: CharId;
  activeMap: MapId;
  unlockedChars: CharId[];
  unlockedMaps: MapId[];
  bestSession: number;
  totalSessions: number;
  flagged: boolean;
  createdAt: string;
}

export interface MeDto {
  player: PlayerDto;
  balance: number;
}

export interface SessionStartDto {
  sessionId: string;
  seed: number;
  engineVersion: number;
  config: SessionConfig;
  issuedAt: string;
}

export interface SubmitDto {
  score: number;
  credited: number;
  balance: number;
  best: number;
  isBest: boolean;
  stats: {
    candles: number;
    bestMult: number;
    cleanFlips: number;
    /** Highest level the server's own replay reached. */
    level: number;
    endReason: string | null;
  };
  rank: { daily: number | null; alltime: number | null };
}

export interface LeaderboardEntryDto {
  rank: number;
  playerId: string;
  name: string;
  score: number;
  charId: string;
  mapId: string;
}

export interface LeaderboardDto {
  window: string;
  entries: LeaderboardEntryDto[];
  me: LeaderboardEntryDto | null;
}

export const api = {
  me: () => call<MeDto>('/me'),
  setName: (name: string) => post<MeDto>('/me/name', { name }),
  migrateGuest: (balance: number) => post<MeDto>('/me/migrate-guest', { balance }),

  nonce: (address: string) => post<{ nonce: string; issuedAt: string }>('/auth/nonce', { address }),
  verify: (message: string, signature: string) =>
    post<{ token: string; player: PlayerDto; balance: number }>('/auth/verify', { message, signature }),
  logout: () => post<unknown>('/auth/logout'),

  startSession: (mapId: MapId, charId: CharId) =>
    post<SessionStartDto>('/session/start', { mapId, charId }),
  submitSession: (payload: {
    sessionId: string;
    inputs: InputEvent[];
    clientScore: number;
    clientDigest: string;
  }) => post<SubmitDto>('/session/submit', payload),

  unlock: (itemId: string) => post<{ player: PlayerDto; balance: number; spent: number }>('/shop/unlock', { itemId }),

  leaderboard: (window: 'daily' | 'weekly' | 'alltime', limit = 25) =>
    call<LeaderboardDto>(`/leaderboard?window=${window}&limit=${limit}`),
};
