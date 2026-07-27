'use client';

import { useEffect, useState } from 'react';

/**
 * The contract address on the opening screen, copyable in one tap.
 *
 * The value is read from the build, so publishing the real address is a redeploy and not a
 * code change. Until it is set the chip reads COMING SOON and copies that — a chip that
 * silently copies nothing is worse than one that copies the honest answer.
 */
const CONTRACT = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? '').trim();
const PLACEHOLDER = 'COMING SOON';

/**
 * Clipboard, the long way round.
 *
 * `navigator.clipboard` is unavailable on plain http and inside some in-app browsers —
 * exactly the ones a link from X opens in — so the old selection trick is kept as a
 * fallback. It needs its own selectability because the body sets `user-select: none` to
 * stop the game screen highlighting under a drag.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText =
      'position:fixed;top:0;left:0;opacity:0;pointer-events:none;user-select:text;-webkit-user-select:text';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function ContractAddress() {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const value = CONTRACT || PLACEHOLDER;
  const live = CONTRACT.length > 0;

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <button
      type="button"
      className={`ca${state === 'done' ? ' done' : ''}${state === 'failed' ? ' failed' : ''}`}
      onClick={() => void copyText(value).then((ok) => setState(ok ? 'done' : 'failed'))}
      aria-label={live ? `Copy contract address ${value}` : 'Contract address coming soon'}
    >
      <span className="k1">CA</span>
      <span className={`v${live ? '' : ' soon'}`}>{value}</span>
      <span className="cp">
        {state === 'done' ? (
          <>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12.5 9.5 18 20 7" />
            </svg>
            <b>COPIED</b>
          </>
        ) : state === 'failed' ? (
          <b>SELECT IT</b>
        ) : (
          <>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2.5" />
              <path d="M5 15V6a2 2 0 0 1 2-2h8" />
            </svg>
            <b>COPY</b>
          </>
        )}
      </span>
    </button>
  );
}
