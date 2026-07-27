'use client';

import type { SimSnapshot } from '@candle-rush/engine';
import { useEffect, useRef } from 'react';
import { mmss, money } from '../../lib/format';

/**
 * The in-run overlay. Reads the snapshot, writes nothing.
 *
 * The numbers update every frame, so they are written straight to the DOM through refs
 * rather than through React state — sixty re-renders a second of the whole tree to change
 * one string is a lot of work to make a canvas game stutter.
 */
export function Hud({
  snapRef,
  longOnly,
  soundOn,
  onToggleSound,
  onTogglePause,
  visible,
}: {
  snapRef: { current: SimSnapshot | null };
  longOnly: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  onTogglePause: () => void;
  visible: boolean;
}) {
  const pnl = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLDivElement>(null);
  const levelRef = useRef<HTMLDivElement>(null);
  const mult = useRef<HTMLDivElement>(null);
  const pos = useRef<HTMLDivElement>(null);
  const posTxt = useRef<HTMLSpanElement>(null);
  const buffs = useRef<HTMLDivElement>(null);
  const spark = useRef<HTMLCanvasElement>(null);
  const curve = useRef<number[]>([0]);
  const lastSample = useRef(0);
  const lastShort = useRef<boolean | null>(null);

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const paint = () => {
      const s = snapRef.current;
      if (s) {
        if (pnl.current) pnl.current.textContent = money(s.pnl);
        if (clock.current) {
          clock.current.textContent = mmss(s.left);
          clock.current.classList.toggle('bell', s.belled);
        }
        if (levelRef.current) levelRef.current.textContent = `LEVEL ${s.level}`;
        if (mult.current) {
          mult.current.textContent = `×${s.mult}`;
          mult.current.classList.toggle('on', s.mult > 1);
        }
        if (pos.current && !longOnly && lastShort.current !== s.player.short) {
          lastShort.current = s.player.short;
          pos.current.className = `show ${s.player.short ? 'short' : 'long'}`;
          if (posTxt.current) posTxt.current.textContent = s.player.short ? 'SHORT' : 'LONG';
          pos.current.classList.remove('flash');
          void pos.current.offsetWidth;
          pos.current.classList.add('flash');
        }
        if (buffs.current) {
          let html = '';
          if (s.buffs.lev > 0)
            html += `<div class="buff" style="color:var(--gold)"><i></i>LEVERAGE 2× ${s.buffs.lev.toFixed(1)}s</div>`;
          if (s.buffs.bull > 0)
            html += `<div class="buff" style="color:var(--bull)"><i></i>MOMENTUM ${s.buffs.bull.toFixed(1)}s</div>`;
          if (s.buffs.shield) html += `<div class="buff" style="color:var(--ice)"><i></i>HEDGE ACTIVE</div>`;
          if (buffs.current.innerHTML !== html) buffs.current.innerHTML = html;
        }
        if (s.t - lastSample.current > 0.14) {
          lastSample.current = s.t;
          curve.current.push(s.pnl);
          if (curve.current.length > 58) curve.current.shift();
          drawSpark(spark.current, curve.current);
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [snapRef, longOnly, visible]);

  useEffect(() => {
    if (visible) {
      curve.current = [0];
      lastSample.current = 0;
      lastShort.current = null;
    }
  }, [visible]);

  return (
    <div id="hud" className={visible ? 'on' : ''}>
      <div className="top">
        <div>
          <div className="k">SCORE</div>
          <div className="pnl" ref={pnl}>
            $0
          </div>
          <canvas id="spark" ref={spark} width={232} height={48} />
        </div>
        <div>
          <div className="k lvl" ref={levelRef} style={{ textAlign: 'center' }}>
            LEVEL 1
          </div>
          <div className="clockv" ref={clock}>
            1:30
          </div>
        </div>
        <div className="rt">
          <div className="chips">
            <button className={`chip${soundOn ? '' : ' off'}`} aria-label="Sound" onClick={onToggleSound}>
              <svg viewBox="0 0 24 24">
                <path d="M11 5 6 9H3v6h3l5 4z" />
                {soundOn ? <path d="M15.5 8.5a5 5 0 0 1 0 7" /> : <path d="M16 9l5 6M21 9l-5 6" />}
              </svg>
            </button>
            <button className="chip" aria-label="Pause" onClick={onTogglePause}>
              <svg viewBox="0 0 24 24">
                <path d="M9 5v14M15 5v14" />
              </svg>
            </button>
          </div>
          <div className="mult" ref={mult}>
            ×1
          </div>
        </div>
      </div>
      <div id="buffs" ref={buffs} />
      {!longOnly && (
        <div id="pos" className="show long" ref={pos}>
          <svg viewBox="0 0 24 24">
            <path d="M12 4l7 9h-4v7h-6v-7H5z" />
          </svg>
          <span ref={posTxt}>LONG</span>
        </div>
      )}
    </div>
  );
}

function drawSpark(canvas: HTMLCanvasElement | null, curve: number[]): void {
  if (!canvas) return;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(2, 0, 0, 2, 0, 0);
  g.clearRect(0, 0, 116, 24);
  if (curve.length < 2) return;
  const mx = Math.max(1, ...curve);
  g.beginPath();
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 116;
    const y = 24 - (curve[i]! / mx) * 20 - 2;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.strokeStyle = '#22E6A0';
  g.lineWidth = 1.5;
  g.lineJoin = 'round';
  g.stroke();
  g.lineTo(116, 24);
  g.lineTo(0, 24);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, 24);
  grad.addColorStop(0, 'rgba(34,230,160,.26)');
  grad.addColorStop(1, 'rgba(34,230,160,0)');
  g.fillStyle = grad;
  g.fill();
}
