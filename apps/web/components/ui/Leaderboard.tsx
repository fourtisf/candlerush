'use client';

import { useEffect, useState } from 'react';
import { api, type LeaderboardDto } from '../../lib/api';
import { useAccount } from '../../lib/account';
import { money, short } from '../../lib/format';

type Window = 'daily' | 'weekly' | 'alltime';
const WINDOWS: Array<{ id: Window; label: string }> = [
  { id: 'daily', label: 'TODAY' },
  { id: 'weekly', label: 'THIS WEEK' },
  { id: 'alltime', label: 'ALL TIME' },
];

export function LeaderboardScreen({ on, onBack }: { on: boolean; onBack: () => void }) {
  const { account } = useAccount();
  const [window, setWindow] = useState<Window>('daily');
  const [data, setData] = useState<LeaderboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .leaderboard(window, 25)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the leaderboard.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [on, window]);

  const rows = data?.entries ?? [];
  const meOffPage = data?.me && !rows.some((r) => r.playerId === data.me?.playerId) ? data.me : null;

  return (
    <section className={`scr${on ? ' on' : ''}`}>
      <div className="pan">
        <h2>Leaderboard</h2>
        {data?.yesterday && data.yesterday.results.length > 0 && (
          <div className="k" style={{ marginTop: 10 }}>
            YESTERDAY&rsquo;S PODIUM
          </div>
        )}
        <div className="tabs">
          {WINDOWS.map((w) => (
            <button key={w.id} className={`tab${window === w.id ? ' on' : ''}`} onClick={() => setWindow(w.id)}>
              {w.label}
            </button>
          ))}
        </div>
        {data?.yesterday && data.yesterday.results.length > 0 && (
          <div className="podium">
            <div className="k">
              {data.yesterday.day} · {data.yesterday.entrants} ON THE BOARD
            </div>
            {data.yesterday.results.map((r) => (
              <div key={r.rank} className={`prow p${r.rank}`}>
                <span className="pk">#{r.rank}</span>
                <span className="nm">{r.name}</span>
                <span className="sc">{money(r.score)}</span>
                <span className="pz">+{short(r.prize)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="lb">
          {loading && <div className="empty">LOADING…</div>}
          {!loading && error && <div className="empty">{error.toUpperCase()}</div>}
          {!loading && !error && rows.length === 0 && <div className="empty">NOBODY HAS TRADED THIS WINDOW YET</div>}
          {!loading &&
            !error &&
            rows.map((r) => (
              <div key={r.playerId} className={`row${r.playerId === account.playerId ? ' me' : ''}`}>
                <span className="rk">#{r.rank}</span>
                <span className="nm">{r.name}</span>
                <span className="sc">{money(r.score)}</span>
              </div>
            ))}
          {meOffPage && (
            <div className="row me">
              <span className="rk">#{meOffPage.rank}</span>
              <span className="nm">{meOffPage.name}</span>
              <span className="sc">{money(meOffPage.score)}</span>
            </div>
          )}
        </div>
        {account.mode === 'guest' && (
          <div className="unranked">CONNECT A WALLET TO PUT A SCORE ON THIS BOARD</div>
        )}
        <button className="cta wide" onClick={onBack}>
          Done
        </button>
      </div>
    </section>
  );
}
