'use client';

import { charById, mapById, priceOf, type CharId, type MapId, type SessionConfig } from '@candle-rush/engine';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, type PlayerDto, type SubmitDto } from './api';
import { emptyGuest, guestSeed, loadGuest, nextHandicap, saveGuest, type GuestProfile } from './guest';

/**
 * One account shape for two very different things.
 *
 * A guest's progress lives in localStorage and is worth exactly what a player is willing
 * to type into devtools. A signed-in player's progress is the sum of a ledger on a server
 * they do not control. The UI is the same; what it is allowed to claim is not — guest runs
 * are never ranked and say so.
 */

export interface Account {
  mode: 'guest' | 'player';
  ready: boolean;
  name: string;
  balance: number;
  chars: CharId[];
  maps: MapId[];
  char: CharId;
  map: MapId;
  best: number;
  runs: number;
  address?: string;
  playerId?: string;
  flagged?: boolean;
}

export interface StartedSession {
  config: SessionConfig;
  sessionId?: string;
  firstRun: boolean;
}

interface Ctx {
  account: Account;
  guest: GuestProfile;
  error: string | null;
  busy: boolean;
  setName: (name: string) => Promise<void>;
  select: (kind: 'char' | 'map', id: string) => Promise<void>;
  unlock: (itemId: string) => Promise<boolean>;
  startSession: () => Promise<StartedSession>;
  finishSession: (args: {
    sessionId?: string;
    inputs: readonly (readonly [number, number])[];
    clientScore: number;
    clientDigest: string;
    candles: number;
  }) => Promise<SubmitDto | { local: true; score: number }>;
  signedIn: (player: PlayerDto, balance: number) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

const AccountContext = createContext<Ctx | null>(null);

function fromGuest(g: GuestProfile): Account {
  return {
    mode: 'guest',
    ready: true,
    name: g.name,
    balance: g.balance,
    chars: g.chars,
    maps: g.maps,
    char: g.char,
    map: g.map,
    best: g.best,
    runs: g.runs,
  };
}

function fromPlayer(p: PlayerDto, balance: number): Account {
  return {
    mode: 'player',
    ready: true,
    name: p.name,
    balance,
    chars: p.unlockedChars,
    maps: p.unlockedMaps,
    char: p.activeChar,
    map: p.activeMap,
    best: p.bestSession,
    runs: p.totalSessions,
    address: p.address,
    playerId: p.id,
    flagged: p.flagged,
  };
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [guest, setGuest] = useState<GuestProfile>(emptyGuest);
  const [player, setPlayer] = useState<{ p: PlayerDto; balance: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGuest(loadGuest());
    // An httpOnly cookie is invisible to this page, so the only way to find out whether
    // we are signed in is to ask.
    api
      .me()
      .then(({ player: p, balance }) => setPlayer({ p, balance }))
      .catch(() => setPlayer(null))
      .finally(() => setReady(true));
  }, []);

  const account = useMemo<Account>(() => {
    const base = player ? fromPlayer(player.p, player.balance) : fromGuest(guest);
    return { ...base, ready };
  }, [player, guest, ready]);

  const mutateGuest = useCallback((fn: (g: GuestProfile) => GuestProfile) => {
    setGuest((prev) => {
      const next = fn(prev);
      saveGuest(next);
      return next;
    });
  }, []);

  const report = useCallback((err: unknown) => {
    const message =
      err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong.';
    setError(message);
    return message;
  }, []);

  const setName = useCallback(
    async (name: string) => {
      const clean = name.trim().toUpperCase().slice(0, 14);
      if (!clean) return;
      if (player) {
        setBusy(true);
        try {
          const res = await api.setName(clean);
          setPlayer({ p: res.player, balance: res.balance });
        } catch (err) {
          report(err);
        } finally {
          setBusy(false);
        }
      } else {
        mutateGuest((g) => ({ ...g, name: clean }));
      }
    },
    [player, mutateGuest, report],
  );

  const select = useCallback(
    async (kind: 'char' | 'map', id: string) => {
      if (player) {
        // The server records the loadout when the next session is issued, and refuses
        // anything the player does not own. Nothing to do here but reflect the choice.
        setPlayer((prev) =>
          prev
            ? {
                ...prev,
                p: { ...prev.p, ...(kind === 'char' ? { activeChar: id as CharId } : { activeMap: id as MapId }) },
              }
            : prev,
        );
      } else {
        mutateGuest((g) => ({ ...g, ...(kind === 'char' ? { char: id as CharId } : { map: id as MapId }) }));
      }
    },
    [player, mutateGuest],
  );

  const unlock = useCallback(
    async (itemId: string): Promise<boolean> => {
      const item = priceOf(itemId);
      if (!item) return false;
      if (player) {
        setBusy(true);
        try {
          const res = await api.unlock(itemId);
          setPlayer({ p: res.player, balance: res.balance });
          return true;
        } catch (err) {
          report(err);
          return false;
        } finally {
          setBusy(false);
        }
      }
      if (guest.balance < item.cost) return false;
      mutateGuest((g) => ({
        ...g,
        balance: g.balance - item.cost,
        ...(item.kind === 'char'
          ? { chars: [...g.chars, itemId as CharId], char: itemId as CharId }
          : { maps: [...g.maps, itemId as MapId], map: itemId as MapId }),
      }));
      return true;
    },
    [player, guest.balance, mutateGuest, report],
  );

  const startSession = useCallback(async (): Promise<StartedSession> => {
    if (player) {
      const started = await api.startSession(player.p.activeMap, player.p.activeChar);
      return { config: started.config, sessionId: started.sessionId, firstRun: player.p.totalSessions === 0 };
    }
    return {
      config: {
        seed: guestSeed(),
        mapId: guest.map,
        charId: guest.char,
        handicap: guest.handicap,
        engineVersion: (await import('@candle-rush/engine')).ENGINE_VERSION,
      },
      firstRun: guest.firstRun,
    };
  }, [player, guest.map, guest.char, guest.handicap, guest.firstRun]);

  const finishSession = useCallback<Ctx['finishSession']>(
    async ({ sessionId, inputs, clientScore, clientDigest, candles }) => {
      if (player && sessionId) {
        const res = await api.submitSession({
          sessionId,
          inputs: inputs as never,
          clientScore,
          clientDigest,
        });
        setPlayer((prev) =>
          prev
            ? {
                ...prev,
                balance: res.balance,
                p: { ...prev.p, bestSession: res.best, totalSessions: prev.p.totalSessions + 1 },
              }
            : prev,
        );
        return res;
      }
      // Guest: local, unranked, and openly worth nothing.
      mutateGuest((g) => ({
        ...g,
        balance: g.balance + clientScore,
        best: Math.max(g.best, clientScore),
        runs: g.runs + 1,
        handicap: nextHandicap(g.handicap, candles),
        firstRun: false,
      }));
      return { local: true as const, score: clientScore };
    },
    [player, mutateGuest],
  );

  const signedIn = useCallback((p: PlayerDto, balance: number) => {
    setPlayer({ p, balance });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* the cookie is gone either way as far as this tab is concerned */
    }
    setPlayer(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api.me();
      setPlayer({ p: res.player, balance: res.balance });
    } catch {
      setPlayer(null);
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      account,
      guest,
      error,
      busy,
      setName,
      select,
      unlock,
      startSession,
      finishSession,
      signedIn,
      signOut,
      refresh,
      clearError: () => setError(null),
    }),
    [account, guest, error, busy, setName, select, unlock, startSession, finishSession, signedIn, signOut, refresh],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): Ctx {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used inside AccountProvider');
  return ctx;
}

export const activeChar = (a: Account) => charById(a.char);
export const activeMap = (a: Account) => mapById(a.map);
