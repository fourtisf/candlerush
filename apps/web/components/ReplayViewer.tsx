'use client';

import {
  STEP,
  Sim,
  charById,
  mapById,
  type CharId,
  type InputEvent,
  type MapId,
} from '@candle-rush/engine';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, type ReplayDto } from '../lib/api';
import { money, mmss } from '../lib/format';
import { Renderer } from './game/renderer';
import { Wordmark } from './ui/Wordmark';

/**
 * Play somebody else's run back.
 *
 * The same simulation the game uses, driven by the same tape the server scored — so this
 * is not a video of a run, it is the run. If the number on screen at the end differs from
 * the one the server published, determinism has broken and this page is where it shows.
 */
export function ReplayViewer({ sessionId }: { sessionId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<ReplayDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState({ score: 0, level: 1, left: 0, done: false });
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  const runRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    let alive = true;
    api
      .replay(sessionId)
      .then((r) => alive && setData(r))
      .catch((e) =>
        alive && setError(e instanceof ApiError ? e.message : 'Could not load that run.'),
      );
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const play = useCallback(
    (replay: ReplayDto) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      runRef.current?.stop();

      const renderer = new Renderer(
        canvas,
        mapById(replay.config.mapId as MapId),
        charById(replay.config.charId as CharId),
      );
      renderer.reset();
      const sim = new Sim(replay.config, { events: true });
      const tape = replay.inputs as InputEvent[];

      let cursor = 0;
      let acc = 0;
      let last = performance.now();
      let raf = 0;
      let running = true;

      const onResize = () => renderer.resize();
      window.addEventListener('resize', onResize, { passive: true });

      const frame = (now: number) => {
        if (!running) return;
        const dt = Math.min((now - last) / 1000, 0.25) * speedRef.current;
        last = now;
        acc += dt;
        let steps = 0;
        while (acc >= STEP && sim.mode !== 'ended' && steps < 600) {
          // Inputs land at the head of the frame they were stamped for, exactly as they did
          // when this was played and exactly as the server replayed it.
          while (cursor < tape.length && tape[cursor]![0] === sim.frame) {
            sim.applyInput(tape[cursor]![1]);
            cursor++;
          }
          sim.step();
          renderer.consume(sim.drainEvents());
          acc -= STEP;
          steps++;
        }
        const snap = sim.snapshot();
        renderer.update(dt, snap);
        renderer.render(snap, acc / STEP, { hint: 0, paused: false, t: snap.t });
        setLive({
          score: sim.score,
          level: snap.level,
          left: snap.left,
          done: sim.mode === 'ended',
        });
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);

      runRef.current = {
        stop: () => {
          running = false;
          cancelAnimationFrame(raf);
          window.removeEventListener('resize', onResize);
        },
      };
    },
    [],
  );

  useEffect(() => {
    if (data) play(data);
    return () => runRef.current?.stop();
  }, [data, play]);

  const matches = data ? live.done && live.score === data.score : true;

  return (
    <div id="stage" className="replay">
      <canvas id="game" ref={canvasRef} />

      <div className="rvtop">
        <Link href="/" className="rvhome" aria-label="Candle Rush">
          <Wordmark className="rvmark" />
        </Link>
        {data && (
          <div className="rvwho">
            <span className="k">REPLAY</span>
            <b>{data.name}</b>
          </div>
        )}
      </div>

      {data && (
        <div className="rvhud">
          <div>
            <div className="k">SCORE</div>
            <div className="pnl">{money(live.score)}</div>
          </div>
          <div>
            <div className="k lvl">LEVEL {live.level}</div>
            <div className="clockv">{mmss(live.left)}</div>
          </div>
        </div>
      )}

      <div className="rvbar">
        {error ? (
          <div className="err">{error}</div>
        ) : !data ? (
          <div className="k">LOADING THE TAPE…</div>
        ) : (
          <>
            <div className="rvspeed">
              {[0.5, 1, 2, 4].map((s) => (
                <button
                  key={s}
                  className={`tab${speed === s ? ' on' : ''}`}
                  onClick={() => setSpeed(s)}
                >
                  {s}×
                </button>
              ))}
              <button className="tab" onClick={() => play(data)}>
                REPLAY
              </button>
            </div>
            <div className="rvfinal">
              {live.done ? (
                <>
                  <span className="k">FINAL</span>
                  <b>{money(data.score)}</b>
                  <span className="k">LEVEL {data.level}</span>
                  {/* The whole point of publishing the tape rather than the picture: you
                      can check the number, and so can everybody else. */}
                  <span className={matches ? 'verify ok' : 'verify bad'}>
                    {matches ? 'MATCHES THE SERVER' : 'DOES NOT MATCH THE SERVER'}
                  </span>
                </>
              ) : (
                <span className="k">
                  {data.candles} CANDLES · ×{data.bestMult} BEST STREAK
                </span>
              )}
            </div>
            <Link href="/" className="cta sm">
              Play it yourself
            </Link>
          </>
        )}
      </div>

      <div id="rotate">
        <div>
          <b>Turn your phone</b>
          Candle Rush runs at a fixed 1280×720, so a replay needs a landscape screen too.
        </div>
      </div>
    </div>
  );
}
