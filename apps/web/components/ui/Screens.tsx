'use client';

import { CHARS, MAPS, charById, mapById, type CharDef, type MapDef } from '@candle-rush/engine';
import { useEffect, useMemo, useState } from 'react';
import { useAccount, type Account } from '../../lib/account';
import { money, shortAddress, short } from '../../lib/format';
import { charThumb, rgb, skyThumb } from '../game/sprites';
import { WalletButton } from './WalletButton';

/* ── profile ───────────────────────────────────────────────────────────────── */

export function ProfileScreen({ on, onEnter, onError }: { on: boolean; onEnter: () => void; onError: (m: string) => void }) {
  const { account, setName } = useAccount();
  const [value, setValue] = useState(account.name);

  useEffect(() => setValue(account.name), [account.name]);

  return (
    <section className={`scr${on ? ' on' : ''}`}>
      <div className="pan">
        <div className="eyebrow">ROBINHOOD CHAIN · ARCADE</div>
        <h1>
          CANDLE<span className="b">RUSH</span>
        </h1>
        <p className="lede">Ninety seconds on the chart. Ride the candles, bank the close.</p>
        <input
          type="text"
          maxLength={14}
          placeholder="TRADER NAME"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
        />
        <WalletButton onError={onError} />
        <div style={{ height: 18 }} />
        <button
          className="cta wide"
          onClick={() => {
            void setName(value || `TRADER${Math.floor(100 + Math.random() * 900)}`);
            onEnter();
          }}
        >
          Open account
        </button>
        <div className="keys">A WALLET IS OPTIONAL WHILE YOU PLAY LOCALLY</div>
      </div>
    </section>
  );
}

/* ── hub ───────────────────────────────────────────────────────────────────── */

export function HubScreen({
  on,
  onPlay,
  onChars,
  onMaps,
  onLeaderboard,
  starting,
}: {
  on: boolean;
  onPlay: () => void;
  onChars: () => void;
  onMaps: () => void;
  onLeaderboard: () => void;
  starting: boolean;
}) {
  const { account, error } = useAccount();
  const char = charById(account.char);
  const map = mapById(account.map);
  const thumb = useMemo(() => (on ? charThumb(char, 34) : ''), [char, on]);

  return (
    <section className={`scr${on ? ' on' : ''}`}>
      <div className="pan">
        <div className="k">ACCOUNT BALANCE</div>
        <div className="bal">{money(account.balance)}</div>
        <div className="who">
          <b>{account.name || 'TRADER'}</b>
          <span>{account.address ? `· ${shortAddress(account.address)}` : '· LOCAL'}</span>
        </div>
        <div className="pick">
          <button className="pk" onClick={onChars}>
            {thumb ? <img src={thumb} alt="" /> : <span className="sw" />}
            <span className="tx">
              <span className="l1">TRADER</span>
              <span className="l2">{char.name}</span>
            </span>
          </button>
          <button className="pk" onClick={onMaps}>
            <span className="sw">
              {map.sky[1].map((c, i) => (
                <i key={i} style={{ background: rgb(c) }} />
              ))}
            </span>
            <span className="tx">
              <span className="l1">MARKET</span>
              <span className="l2">{map.name}</span>
            </span>
          </button>
        </div>
        <button className={`cta g wide${starting ? ' busy' : ''}`} onClick={onPlay}>
          {starting ? 'Opening…' : 'Open the session'}
        </button>
        <button className="ghost" onClick={onLeaderboard}>
          LEADERBOARD
        </button>
        <div className="keys">
          BEST SESSION {account.best ? money(account.best) : '—'} · {account.runs} SESSIONS
        </div>
        {account.mode === 'guest' && (
          <div className="unranked">
            PLAYING LOCALLY — PROGRESS IS SAVED IN THIS BROWSER
            <br />
            AND SESSIONS ARE NOT RANKED. CONNECT A WALLET TO COMPETE.
          </div>
        )}
        {error && <div className="err">{error}</div>}
      </div>
    </section>
  );
}

/* ── shop ──────────────────────────────────────────────────────────────────── */

export function CharScreen({ on, onBack, onToast }: { on: boolean; onBack: () => void; onToast: (t: string, c?: string) => void }) {
  const { account, select, unlock, busy } = useAccount();
  const thumbs = useMemo(() => (on ? Object.fromEntries(CHARS.map((c) => [c.id, charThumb(c, 54)])) : {}), [on]);

  const pick = async (c: CharDef) => {
    if (account.chars.includes(c.id)) {
      void select('char', c.id);
      return;
    }
    if (account.balance < c.cost) {
      onToast(`NEED ${short(c.cost - account.balance)} MORE`, '#FF4A6B');
      return;
    }
    if (await unlock(c.id)) onToast(`UNLOCKED ${c.name.toUpperCase()}`, c.col);
  };

  return (
    <section className={`scr${on ? ' on' : ''}`}>
      <div className="pan">
        <h2>Traders</h2>
        <div className="k" style={{ marginTop: 8 }}>
          BALANCE {money(account.balance)}
        </div>
        <div className={`grid${busy ? ' busy' : ''}`}>
          {CHARS.map((c) => {
            const own = account.chars.includes(c.id);
            const sel = account.char === c.id;
            return (
              <button key={c.id} className={`card${sel ? ' sel' : ''}${own ? '' : ' lock'}`} onClick={() => void pick(c)}>
                {sel && <span className="tag">ACTIVE</span>}
                <div className="av">{thumbs[c.id] ? <img src={thumbs[c.id]} alt="" /> : null}</div>
                <div className="nm">{c.name}</div>
                <div className="pr">{c.perk}</div>
                {!own && <div className="cost">{short(c.cost)} TO UNLOCK</div>}
              </button>
            );
          })}
        </div>
        <button className="cta wide" onClick={onBack}>
          Done
        </button>
      </div>
    </section>
  );
}

export function MapScreen({ on, onBack, onToast }: { on: boolean; onBack: () => void; onToast: (t: string, c?: string) => void }) {
  const { account, select, unlock, busy } = useAccount();
  const thumbs = useMemo(() => (on ? Object.fromEntries(MAPS.map((m) => [m.id, skyThumb(m, 130, 58)])) : {}), [on]);

  const pick = async (m: MapDef) => {
    if (account.maps.includes(m.id)) {
      void select('map', m.id);
      return;
    }
    if (account.balance < m.cost) {
      onToast(`NEED ${short(m.cost - account.balance)} MORE`, '#FF4A6B');
      return;
    }
    if (await unlock(m.id)) onToast(`UNLOCKED ${m.name.toUpperCase()}`, '#FFCE5C');
  };

  return (
    <section className={`scr${on ? ' on' : ''}`}>
      <div className="pan">
        <h2>Markets</h2>
        <div className="k" style={{ marginTop: 8 }}>
          BALANCE {money(account.balance)}
        </div>
        <div className={`grid${busy ? ' busy' : ''}`}>
          {MAPS.map((m) => {
            const own = account.maps.includes(m.id);
            const sel = account.map === m.id;
            return (
              <button key={m.id} className={`card${sel ? ' sel' : ''}${own ? '' : ' lock'}`} onClick={() => void pick(m)}>
                {sel && <span className="tag">ACTIVE</span>}
                <div className="thumb">
                  {thumbs[m.id] ? (
                    <img src={thumbs[m.id]} style={{ width: '100%', height: '100%', display: 'block' }} alt="" />
                  ) : null}
                </div>
                <div className="nm">{m.name}</div>
                <div className="pr">
                  {m.note}
                  <br />
                  {m.pay.toFixed(1)}× payout
                </div>
                <div className="dots">
                  {[0, 1, 2, 3].map((i) => (
                    <i key={i} className={i < m.tier ? 'f' : ''} />
                  ))}
                </div>
                {!own && <div className="cost">{short(m.cost)} TO UNLOCK</div>}
              </button>
            );
          })}
        </div>
        <button className="cta wide" onClick={onBack}>
          Done
        </button>
      </div>
    </section>
  );
}

/* ── revive ────────────────────────────────────────────────────────────────── */

export function ReviveScreen({
  on,
  pnl,
  secondsLeft,
  onRevive,
  onEnd,
}: {
  on: boolean;
  pnl: number;
  secondsLeft: number;
  onRevive: () => void;
  onEnd: () => void;
}) {
  return (
    <section className={`scr${on ? ' on' : ''}`}>
      <div className="pan">
        <h2 style={{ color: 'var(--bear)' }}>LIQUIDATED</h2>
        <div className="k" style={{ marginTop: 9 }}>
          ONE TOP-UP PER SESSION
        </div>
        <div style={{ height: 18 }} />
        <div className="k">P&amp;L ON THE TABLE</div>
        <div className="big">{money(pnl)}</div>
        <div style={{ height: 22 }} />
        <button className="cta g wide" onClick={onRevive}>
          Add margin — keep trading
        </button>
        <div className="bar">
          <i style={{ width: `${Math.max(0, (secondsLeft / 6) * 100)}%` }} />
        </div>
        <button className="ghost" onClick={onEnd}>
          Close the position ({Math.max(0, Math.ceil(secondsLeft))})
        </button>
      </div>
    </section>
  );
}

/* ── level clear ───────────────────────────────────────────────────────────── */

export function LevelScreen({
  on,
  level,
  pnl,
  candles,
  secondsLeft,
  onContinue,
}: {
  on: boolean;
  level: number;
  pnl: number;
  candles: number;
  secondsLeft: number;
  onContinue: () => void;
}) {
  return (
    <section className={`scr${on ? ' on' : ''}`}>
      <div className="pan">
        <div className="eyebrow">LEVEL {level} CLEARED</div>
        <div className="k">P&amp;L SO FAR</div>
        <div className="big">{money(pnl)}</div>
        <div className="stats">
          <div className="st">
            <div className="v">{candles}</div>
            <div className="l">CANDLES</div>
          </div>
          <div className="st">
            <div className="v">{level + 1}</div>
            <div className="l">NEXT LEVEL</div>
          </div>
          <div className="st">
            <div className="v">+{Math.round(level * 25)}%</div>
            <div className="l">PAYOUT</div>
          </div>
        </div>
        <button className="cta g wide" onClick={onContinue}>
          Continue
        </button>
        <div className="bar">
          <i style={{ width: `${Math.max(0, (secondsLeft / 8) * 100)}%` }} />
        </div>
        <div className="keys">
          FASTER TAPE, MORE HOLES, SHORTER TRENDS — STARTS IN {Math.max(0, Math.ceil(secondsLeft))}
        </div>
      </div>
    </section>
  );
}

/* ── results ───────────────────────────────────────────────────────────────── */

export interface Result {
  title: string;
  level: number;
  score: number;
  credited: number;
  candles: number;
  bestMult: number;
  cleanFlips: number;
  isBest: boolean;
  ranked: boolean;
  rank: number | null;
  note: string;
  error?: string;
}

export function OverScreen({
  on,
  result,
  onAgain,
  onHub,
  submitting,
}: {
  on: boolean;
  result: Result | null;
  onAgain: () => void;
  onHub: () => void;
  submitting: boolean;
}) {
  const { account } = useAccount();
  if (!result) return <section className="scr" />;

  const next = [...CHARS, ...MAPS]
    .filter((o) => !(account.chars as string[]).includes(o.id) && !(account.maps as string[]).includes(o.id))
    .sort((a, b) => a.cost - b.cost)[0];

  return (
    <section className={`scr${on ? ' on' : ''}`}>
      <div className="pan">
        <div className="eyebrow">{result.title}</div>
        <div className="k">SESSION P&amp;L</div>
        <div className="big">{submitting ? '…' : money(result.score)}</div>
        <div className="credit">
          {submitting
            ? 'VALIDATING WITH THE SERVER…'
            : result.error
              ? ''
              : `+ ${money(result.credited)} CREDITED TO YOUR ACCOUNT`}
        </div>
        <div className="stats">
          <div className="st">
            <div className="v">{result.level}</div>
            <div className="l">LEVEL</div>
          </div>
          <div className="st">
            <div className="v">{result.candles}</div>
            <div className="l">CANDLES</div>
          </div>
          <div className="st">
            <div className="v">×{result.bestMult}</div>
            <div className="l">BEST STREAK</div>
          </div>
        </div>
        <button className="cta wide" onClick={onAgain}>
          Trade again
        </button>
        <button className="ghost" onClick={onHub}>
          Back to account
        </button>
        <div className="note">
          {result.isBest
            ? 'NEW PERSONAL BEST'
            : result.rank
              ? `RANKED #${result.rank} TODAY`
              : next
                ? `${short(Math.max(0, next.cost - account.balance))} MORE TO UNLOCK ${next.name.toUpperCase()}`
                : 'EVERYTHING UNLOCKED'}
        </div>
        {!result.ranked && !result.error && (
          <div className="unranked">GUEST SESSION — SCORED LOCALLY, NOT RANKED</div>
        )}
        {result.error && <div className="err">{result.error}</div>}
      </div>
    </section>
  );
}

export function accountName(a: Account): string {
  return a.name || 'TRADER';
}
