'use client';

import { CHARS, LEVEL, MAPS, charById, mapById, type CharDef, type MapDef } from '@candle-rush/engine';
import { useEffect, useMemo, useState } from 'react';
import { useAccount, type Account } from '../../lib/account';
import { money, shortAddress, short } from '../../lib/format';
import { charThumb, rgb, skyThumb } from '../game/sprites';
import { ContractAddress } from './ContractAddress';
import { StakePicker } from './StakePicker';
import { WalletButton } from './WalletButton';
import { Wordmark } from './Wordmark';

/* ── profile ───────────────────────────────────────────────────────────────── */

/**
 * Exactly the server's rule, character for character — see `nameSchema` in
 * apps/api/src/schemas.ts. Checking anything looser here means the player types a name,
 * the button lets them through, and the API rejects it with a message about a regex.
 */
const NAME_ALLOWED = /^[\p{L}\p{N} ._-]+$/u;
const NAME_MAX = 14;

function nameProblem(raw: string): string | null {
  const clean = raw.trim();
  if (!clean) return 'PICK A NAME TO OPEN YOUR ACCOUNT';
  if (clean.length > NAME_MAX) return `${NAME_MAX} CHARACTERS MAXIMUM`;
  if (!NAME_ALLOWED.test(clean)) return 'LETTERS, NUMBERS, SPACE, DOT, DASH AND UNDERSCORE ONLY';
  return null;
}

export function ProfileScreen({ on, onEnter, onError }: { on: boolean; onEnter: () => void; onError: (m: string) => void }) {
  const { account, setName, busy } = useAccount();
  const [value, setValue] = useState(account.name);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  // Only adopt a name the player actually chose. A server placeholder in the box would
  // read as "already filled in" and put them straight back where they started.
  useEffect(() => {
    if (account.named) setValue(account.name);
  }, [account.name, account.named]);

  const problem = nameProblem(value);

  const submit = async () => {
    setTouched(true);
    if (problem || saving) return;
    setSaving(true);
    try {
      // Only move on if the name stuck. A failed save used to drop the player into the hub
      // with no name on the account at all.
      if (await setName(value)) onEnter();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`scr${on ? ' on' : ''}`}>
      <div className="pan">
        <div className="eyebrow">ROBINHOOD CHAIN · ARCADE</div>
        <Wordmark className="logo" />
        <p className="lede">Ride the candles, bank the close.</p>
        <ContractAddress />
        <input
          type="text"
          maxLength={NAME_MAX}
          placeholder="TRADER NAME"
          autoComplete="off"
          spellCheck={false}
          required
          aria-invalid={touched && !!problem}
          aria-describedby="namehint"
          value={value}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            setValue(next);
            // Flag a bad character the moment it is typed, but do not nag an empty field
            // somebody has not reached yet.
            if (next.trim()) setTouched(true);
          }}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <div id="namehint" className={`hint${touched && problem ? ' bad' : ''}`}>
          {touched && problem ? problem : 'THIS IS THE NAME ON THE LEADERBOARD'}
        </div>
        <WalletButton onError={onError} />
        <div style={{ height: 14 }} />
        {/* Dimmed but never `disabled`. A disabled button swallows the click, so pressing
            it while the field is empty would say nothing at all — the player is left with
            a grey button and no reason. This one answers when pressed. */}
        <button
          className={`cta wide${problem ? ' off' : ''}${saving || busy ? ' busy' : ''}`}
          aria-disabled={!!problem || saving || busy}
          onClick={() => void submit()}
        >
          {saving ? 'Opening…' : 'Open account'}
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
  onHowTo,
  stake,
  onStake,
  starting,
}: {
  on: boolean;
  onPlay: () => void;
  onChars: () => void;
  onMaps: () => void;
  onLeaderboard: () => void;
  onHowTo: () => void;
  stake: string;
  onStake: (id: string) => void;
  starting: boolean;
}) {
  const { account, setName, error } = useAccount();
  const char = charById(account.char);
  const map = mapById(account.map);
  const thumb = useMemo(() => (on ? charThumb(char, 34) : ''), [char, on]);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(account.name);

  useEffect(() => setDraft(account.name), [account.name]);

  const saveName = async () => {
    if (nameProblem(draft)) return;
    if (await setName(draft)) setRenaming(false);
  };

  return (
    <section className={`scr${on ? ' on' : ''}`}>
      <div className="pan">
        <div className="k">ACCOUNT BALANCE</div>
        <div className="bal">{money(account.balance)}</div>
        {renaming ? (
          <div className="renamer">
            <input
              type="text"
              maxLength={NAME_MAX}
              value={draft}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setDraft(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveName();
                if (e.key === 'Escape') {
                  setDraft(account.name);
                  setRenaming(false);
                }
              }}
            />
            <button className={`mini${nameProblem(draft) ? ' off' : ''}`} onClick={() => void saveName()}>
              SAVE
            </button>
            <button
              className="mini ghosty"
              onClick={() => {
                setDraft(account.name);
                setRenaming(false);
              }}
            >
              CANCEL
            </button>
          </div>
        ) : (
          <button className="who" onClick={() => setRenaming(true)} title="Change your name">
            <b>{account.name || 'TRADER'}</b>
            <span>{account.address ? `· ${shortAddress(account.address)}` : '· LOCAL'}</span>
            <i className="pen" aria-hidden="true">
              EDIT
            </i>
          </button>
        )}
        {account.playStreak > 1 && (
          <div className="streak">
            {account.playStreak} DAY STREAK
            {account.bestStreak > account.playStreak ? ` · BEST ${account.bestStreak}` : ''}
          </div>
        )}
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
        {account.mode === 'player' && (
          <StakePicker value={stake} balance={account.balance} onPick={onStake} />
        )}
        <button className={`cta g wide${starting ? ' busy' : ''}`} onClick={onPlay}>
          {starting ? 'Opening…' : 'Open the session'}
        </button>
        <div className="hubnav">
          <button className="ghost" onClick={onLeaderboard}>
            LEADERBOARD
          </button>
          <button className="ghost" onClick={onHowTo}>
            HOW TO PLAY
          </button>
        </div>
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
        <div className="k">SCORE ON THE TABLE</div>
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
  onBack,
}: {
  on: boolean;
  level: number;
  pnl: number;
  candles: number;
  secondsLeft: number;
  onContinue: () => void;
  onBack: () => void;
}) {
  const seconds = Math.max(0, Math.ceil(secondsLeft));
  // The panel continues by itself, so the bar has to read against the real break length
  // rather than a copy of it — a divisor that drifts from LEVEL.breakSeconds would show a
  // bar that empties early or never empties at all.
  const pct = clamp01(secondsLeft / LEVEL.breakSeconds) * 100;
  const last = level + 1 > LEVEL.maxLevels;

  return (
    <section className={`scr${on ? ' on' : ''}`}>
      <div className="pan">
        <div className="lvlpan">
          <div className="lvlbadge">
            LEVEL {level}
            <b>CLEARED</b>
          </div>
          <div className="k">SCORE</div>
          <div className="big">{money(pnl)}</div>
          <div className="stats">
            <div className="st">
              <div className="v">{candles}</div>
              <div className="l">CANDLES</div>
            </div>
            <div className="st">
              <div className="v">{last ? '—' : level + 1}</div>
              <div className="l">NEXT LEVEL</div>
            </div>
            <div className="st">
              <div className="v gold">+{Math.round(level * 25)}%</div>
              <div className="l">PAYOUT</div>
            </div>
          </div>
          <div className="acts">
            <button className="cta o" onClick={onBack}>
              Back
            </button>
            <button className="cta g" onClick={onContinue}>
              Continue
            </button>
          </div>
          <div className="actnote">
            <span>BANK {money(pnl)} AND STOP</span>
            <span>LEVEL {level + 1} IN {seconds}</span>
          </div>
          <div className="bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="keys">FASTER TAPE · MORE HOLES · SHORTER TRENDS</div>
        </div>
      </div>
    </section>
  );
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/* ── results ───────────────────────────────────────────────────────────────── */

export interface Result {
  title: string;
  level: number;
  /** Absent for a guest run — there is no ledger, so there was nothing at stake. */
  stake?: { id: string; cost: number; mult: number; net: number };
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
  onShare,
  shareState,
  submitting,
}: {
  on: boolean;
  result: Result | null;
  onAgain: () => void;
  onHub: () => void;
  onShare: () => void;
  shareState: 'idle' | 'shared' | 'saved' | 'failed';
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
        <div className="k">SCORE</div>
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
        {result.stake && result.stake.cost > 0 && (
          <div className="netrow">
            <span>
              {result.stake.id.toUpperCase()} STAKE −{short(result.stake.cost)} · ×{result.stake.mult}
            </span>
            <b className={result.stake.net >= 0 ? 'up' : 'down'}>
              {result.stake.net >= 0 ? '+' : '−'}
              {short(Math.abs(result.stake.net))} NET
            </b>
          </div>
        )}
        <button className="cta wide" onClick={onAgain}>
          Trade again
        </button>
        <div className="hubnav">
          <button className="ghost" onClick={onHub}>
            BACK TO ACCOUNT
          </button>
          <button className="ghost" onClick={onShare} disabled={submitting}>
            {shareState === 'shared'
              ? 'SHARED'
              : shareState === 'saved'
                ? 'SAVED TO YOUR DEVICE'
                : shareState === 'failed'
                  ? 'COULD NOT SHARE'
                  : 'SHARE THIS RUN'}
          </button>
        </div>
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
