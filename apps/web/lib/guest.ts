import { DEFAULT_CHAR, DEFAULT_MAP, clamp, type CharId, type MapId } from '@candle-rush/engine';

/**
 * Guest progress.
 *
 * A player who has not connected a wallet still plays, with their balance in
 * localStorage. Forcing a wallet before the first session costs most of the funnel.
 *
 * Nothing here is trusted by anything. Guest sessions are never ranked, the seed is
 * generated locally, and the only route out of this file is the one-time capped carry-over
 * at /me/migrate-guest. Treat every field as something the player can edit, because it is.
 */

const KEY = 'cr:guest:v1';

export interface GuestProfile {
  name: string;
  balance: number;
  chars: CharId[];
  maps: MapId[];
  char: CharId;
  map: MapId;
  best: number;
  runs: number;
  /** Adaptive difficulty, kept locally for guests exactly as the server keeps it for players. */
  handicap: number;
  firstRun: boolean;
}

export const emptyGuest = (): GuestProfile => ({
  name: '',
  balance: 0,
  chars: [DEFAULT_CHAR],
  maps: [DEFAULT_MAP],
  char: DEFAULT_CHAR,
  map: DEFAULT_MAP,
  best: 0,
  runs: 0,
  handicap: 0,
  firstRun: true,
});

export function loadGuest(): GuestProfile {
  if (typeof window === 'undefined') return emptyGuest();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyGuest();
    return { ...emptyGuest(), ...(JSON.parse(raw) as Partial<GuestProfile>) };
  } catch {
    return emptyGuest();
  }
}

export function saveGuest(p: GuestProfile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private browsing, quota, disabled storage. Progress lasts the page session.
  }
}

export function clearGuest(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Ported from `endRun()`. Guests keep their own copy; players get theirs from the server. */
export function nextHandicap(current: number, candlesCleared: number): number {
  if (candlesCleared < 60) return clamp(current + 0.22, 0, 1);
  if (candlesCleared > 170) return clamp(current - 0.3, 0, 1);
  return current;
}

/** A locally chosen seed. Fine for guest play, which is unranked by construction. */
export function guestSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % 2 ** 31;
}
