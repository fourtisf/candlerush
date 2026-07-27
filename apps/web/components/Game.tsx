'use client';

import { ApiError } from '../lib/api';
import {
  IN,
  REVIVE_SECONDS,
  charById,
  mapById,
  type SimEvent,
  type SimSnapshot,
} from '@candle-rush/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '../lib/account';
import { AttractLoop } from './game/attract';
import { Snd } from './game/audio';
import { Renderer } from './game/renderer';
import { LiveSession } from './game/session';
import { Hud } from './ui/Hud';
import { LeaderboardScreen } from './ui/Leaderboard';
import {
  CharScreen,
  HubScreen,
  LevelScreen,
  MapScreen,
  OverScreen,
  ProfileScreen,
  ReviveScreen,
  type Result,
} from './ui/Screens';

type Screen = 'profile' | 'hub' | 'chars' | 'maps' | 'leaderboard' | 'playing' | 'over';

/**
 * The shell.
 *
 * It owns the canvas, the renderer and whichever loop is currently driving it — the
 * attract crawl behind the menus, or a live session. It never touches simulation state:
 * everything it shows comes out of `sim.snapshot()`, and everything it does goes in as an
 * input on a numbered frame.
 */
export function Game() {
  const { account, startSession, finishSession } = useAccount();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const attractRef = useRef<AttractLoop | null>(null);
  const sessionRef = useRef<LiveSession | null>(null);
  const snapRef = useRef<SimSnapshot | null>(null);

  const [screen, setScreen] = useState<Screen>('profile');
  const [soundOn, setSoundOn] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reviving, setReviving] = useState<{ pnl: number; left: number } | null>(null);
  const [levelClear, setLevelClear] = useState<{
    level: number;
    pnl: number;
    candles: number;
    left: number;
  } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [toast, setToast] = useState<{ text: string; colour: string; key: number } | null>(null);
  const [regime, setRegime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showToast = useCallback((text: string, colour = 'var(--gold)') => {
    setToast({ text, colour, key: Date.now() });
  }, []);

  /* ── canvas + attract loop ─────────────────────────────────────────────── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Renderer(canvas, mapById(account.map), charById(account.char));
    rendererRef.current = renderer;
    const attract = new AttractLoop(renderer, account.map, account.char);
    attractRef.current = attract;
    attract.start();

    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      attract.stop();
      sessionRef.current?.stop();
    };
    // Deliberately once: the renderer is retargeted below rather than rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setMap(mapById(account.map));
    renderer.setChar(charById(account.char));
    if (screen !== 'playing') attractRef.current?.restart(account.map, account.char);
  }, [account.map, account.char, screen]);

  useEffect(() => {
    if (account.ready && screen === 'profile' && account.name) setScreen('hub');
  }, [account.ready, account.name, screen]);

  /* ── session lifecycle ─────────────────────────────────────────────────── */

  const onEvents = useCallback(
    (events: readonly SimEvent[]) => {
      for (const e of events) {
        switch (e.t) {
          case 'regime':
            setRegime(e.name);
            break;
          case 'bell':
            showToast('CLOSING BELL — 2× P&L', '#FFCE5C');
            break;
          case 'streak':
            showToast(`×${e.mult} STREAK`, '#FFCE5C');
            break;
          case 'land':
            if (e.perfect && e.perfectRun >= 3 && e.perfectRun % 3 === 0) {
              showToast(`${e.perfectRun}× PERFECT`, '#FFCE5C');
            }
            break;
          case 'stumble':
            if (e.mult > 1) showToast('STUMBLED', '#FF4A6B');
            break;
          case 'power':
            showToast(
              e.kind === 'lev' ? 'LEVERAGE 2×' : e.kind === 'shield' ? 'HEDGE ACTIVE' : 'MOMENTUM',
              e.kind === 'lev' ? '#FFCE5C' : e.kind === 'shield' ? '#6FB4FF' : '#22E6A0',
            );
            break;
          case 'shield':
            showToast('HEDGE SAVED YOU', '#6FB4FF');
            break;
          case 'revive':
            showToast('BACK IN', '#22E6A0');
            break;
          case 'levelStart':
            if (e.level > 1) showToast(`LEVEL ${e.level}`, '#FFCE5C');
            break;
          default:
            break;
        }
      }
    },
    [showToast],
  );

  useEffect(() => {
    if (!regime) return;
    const t = setTimeout(() => setRegime(null), 2600);
    return () => clearTimeout(t);
  }, [regime]);

  const submit = useCallback(
    async (session: LiveSession) => {
      const sim = session.sim;
      const base: Result = {
        title:
          sim.endReason === 'cleared'
            ? 'ALL LEVELS CLEARED'
            : sim.endReason === 'cashedOut'
              ? `CLOSED OUT AFTER LEVEL ${sim.level}`
              : 'LIQUIDATED',
        level: sim.level,
        score: sim.score,
        credited: sim.score,
        candles: sim.cleared,
        bestMult: sim.bestMult,
        cleanFlips: sim.cleanFlips,
        isBest: sim.score > account.best,
        ranked: account.mode === 'player',
        rank: null,
        note: '',
      };
      setResult(base);
      setSubmitting(account.mode === 'player');
      setScreen('over');

      try {
        const payload = session.submission();
        const res = await finishSession({
          sessionId: payload?.sessionId,
          inputs: session.tape,
          clientScore: sim.score,
          clientDigest: payload?.clientDigest ?? '',
          candles: sim.cleared,
        });
        if ('local' in res) {
          setResult({ ...base, ranked: false });
        } else {
          // The server's number, not ours. If they disagree it is the server that is right,
          // and the difference is worth showing rather than hiding.
          setResult({
            ...base,
            score: res.score,
            credited: res.credited,
            candles: res.stats.candles,
            bestMult: res.stats.bestMult,
            cleanFlips: res.stats.cleanFlips,
            level: res.stats.level,
            isBest: res.isBest,
            rank: res.rank.daily,
            ranked: true,
          });
        }
      } catch (err) {
        const message =
          err instanceof ApiError
            ? `${err.message}${err.detail ? ` (${err.detail})` : ''}`
            : 'Could not reach the server. This session was not credited.';
        setResult({ ...base, credited: 0, ranked: false, error: message });
      } finally {
        setSubmitting(false);
      }
    },
    [account.best, account.mode, finishSession],
  );

  const play = useCallback(async () => {
    if (starting) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    setStarting(true);
    setError(null);
    Snd.boot();
    try {
      const started = await startSession();
      attractRef.current?.stop();
      sessionRef.current?.stop();
      renderer.setMap(mapById(started.config.mapId));
      renderer.setChar(charById(started.config.charId));
      renderer.reset();

      const session = new LiveSession(
        started.config,
        renderer,
        {
          onEvents,
          onTick: (snap) => {
            snapRef.current = snap;
            if (snap.mode === 'reviveOffer') setReviving({ pnl: snap.pnl, left: snap.reviveLeft });
            else if (snap.mode === 'running') setReviving((prev) => (prev ? null : prev));
            if (snap.mode === 'levelBreak') {
              setLevelClear({
                level: snap.level,
                pnl: snap.pnl,
                candles: snap.cleared,
                left: snap.breakLeft,
              });
            } else {
              setLevelClear((prev) => (prev ? null : prev));
            }
          },
          onEnd: (s) => void submit(s),
          onPauseExpiring: () => {
            showToast('RESUMING — SUBMISSION WINDOW CLOSING', '#FF4A6B');
            session.setPaused(false);
            setPaused(false);
          },
        },
        { sessionId: started.sessionId },
      );
      if (started.firstRun) session.enableHints();
      sessionRef.current = session;
      snapRef.current = session.sim.snapshot();
      setReviving(null);
      setLevelClear(null);
      setPaused(false);
      setScreen('playing');
      session.start();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.code === 'SESSION_OPEN'
            ? 'You already have a session open. Give it a moment and try again.'
            : err.message
          : 'Could not open a session.';
      setError(message);
      showToast(message.toUpperCase(), '#FF4A6B');
    } finally {
      setStarting(false);
    }
  }, [starting, startSession, onEvents, submit, showToast]);

  const backToMenu = useCallback(
    (to: Screen) => {
      sessionRef.current?.stop();
      sessionRef.current = null;
      snapRef.current = null;
      rendererRef.current?.reset();
      attractRef.current?.restart(account.map, account.char);
      attractRef.current?.start();
      setScreen(to);
    },
    [account.map, account.char],
  );

  /* ── input ─────────────────────────────────────────────────────────────── */

  const togglePause = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.sim.mode === 'ended') return;
    const next = !session.paused;
    session.setPaused(next);
    setPaused(next);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const session = sessionRef.current;
      if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) {
        e.preventDefault();
        if (!e.repeat) {
          Snd.boot();
          session?.press(IN.JUMP_DOWN);
        }
      }
      if (['ShiftLeft', 'ShiftRight', 'ArrowDown', 'KeyS', 'KeyE'].includes(e.code)) {
        e.preventDefault();
        if (!e.repeat) session?.press(IN.FLIP);
      }
      if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
      if (e.code === 'KeyM') {
        Snd.on = !Snd.on;
        setSoundOn(Snd.on);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) sessionRef.current?.press(IN.JUMP_UP);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [togglePause]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      Snd.boot();
      const session = sessionRef.current;
      if (!session) return;
      if (session.paused) {
        togglePause();
        return;
      }
      const longOnly = !!session.sim.map.longOnly;
      const left = rendererRef.current?.isLeftHalf(e.clientX) ?? true;
      session.press(longOnly || left ? IN.JUMP_DOWN : IN.FLIP);
    },
    [togglePause],
  );

  const onPointerUp = useCallback(() => sessionRef.current?.press(IN.JUMP_UP), []);

  /* ── render ────────────────────────────────────────────────────────────── */

  const map = mapById(account.map);
  const inRun = screen === 'playing' && !reviving && !levelClear;

  return (
    <div id="stage">
      <canvas id="game" ref={canvasRef} onPointerDown={onPointerDown} onPointerUp={onPointerUp} />

      <Hud
        snapRef={snapRef}
        longOnly={!!map.longOnly}
        soundOn={soundOn}
        onToggleSound={() => {
          Snd.on = !Snd.on;
          setSoundOn(Snd.on);
        }}
        onTogglePause={togglePause}
        visible={inRun}
      />

      <div id="regime" className={regime ? 'on' : ''}>
        {regime ? `— ${regime} —` : ''}
      </div>
      <div id="toast" key={toast?.key} className={toast ? 'go' : ''} style={{ color: toast?.colour }}>
        {toast?.text ?? ''}
      </div>

      <ProfileScreen on={screen === 'profile'} onEnter={() => setScreen('hub')} onError={setError} />
      <HubScreen
        on={screen === 'hub'}
        starting={starting}
        onPlay={() => void play()}
        onChars={() => setScreen('chars')}
        onMaps={() => setScreen('maps')}
        onLeaderboard={() => setScreen('leaderboard')}
      />
      <CharScreen on={screen === 'chars'} onBack={() => setScreen('hub')} onToast={showToast} />
      <MapScreen on={screen === 'maps'} onBack={() => setScreen('hub')} onToast={showToast} />
      <LeaderboardScreen on={screen === 'leaderboard'} onBack={() => setScreen('hub')} />
      <LevelScreen
        on={!!levelClear}
        level={levelClear?.level ?? 1}
        pnl={levelClear?.pnl ?? 0}
        candles={levelClear?.candles ?? 0}
        secondsLeft={levelClear?.left ?? 0}
        onContinue={() => sessionRef.current?.press(IN.CONTINUE)}
        onBack={() => sessionRef.current?.press(IN.DECLINE)}
      />
      <ReviveScreen
        on={!!reviving}
        pnl={reviving?.pnl ?? 0}
        secondsLeft={reviving?.left ?? REVIVE_SECONDS}
        onRevive={() => sessionRef.current?.press(IN.REVIVE)}
        onEnd={() => sessionRef.current?.press(IN.DECLINE)}
      />
      <OverScreen
        on={screen === 'over'}
        result={result}
        submitting={submitting}
        onAgain={() => void play()}
        onHub={() => backToMenu('hub')}
      />

      <div id="rotate">
        <div>
          <b>Turn your phone</b>
          Candle Rush runs at a fixed 1280×720 so every player gets the same chart from the
          same seed. It needs a landscape screen.
        </div>
      </div>

      {error && screen !== 'playing' && screen !== 'over' && (
        <div
          style={{
            position: 'absolute',
            bottom: `calc(12px + env(safe-area-inset-bottom))`,
            left: 0,
            right: 0,
            textAlign: 'center',
            pointerEvents: 'none',
          }}
          className="err"
        >
          {error}
        </div>
      )}
    </div>
  );
}
