'use client';

/**
 * The rules, shown rather than written.
 *
 * The first version of this was seven paragraphs of monospace over a live chart: a manual,
 * not a tutorial. Nobody reads a manual in an arcade game, and the background bled through
 * every line of it. This one is diagrams with a handful of words each, on an opaque panel,
 * and it fits on one screen.
 */

const S = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Jump() {
  return (
    <svg viewBox="0 0 120 64" aria-hidden="true">
      <rect x="4" y="34" width="30" height="26" rx="6" fill="#4A4436" />
      <rect x="86" y="26" width="30" height="34" rx="6" fill="#22E6A0" />
      <path d="M26 30 C 42 2, 78 2, 94 20" stroke="#FFCE5C" strokeWidth="3" strokeDasharray="1 8" {...S} />
      <rect x="50" y="2" width="20" height="20" rx="6" fill="#FFCE5C" />
    </svg>
  );
}

function Flip() {
  return (
    <svg viewBox="0 0 120 64" aria-hidden="true">
      <rect x="10" y="16" width="26" height="34" rx="6" fill="#22E6A0" />
      <path d="M23 8v10M23 50v8" stroke="#22E6A0" strokeWidth="3" opacity=".5" {...S} />
      <rect x="84" y="16" width="26" height="34" rx="6" fill="#FF4A6B" />
      <path d="M97 8v10M97 50v8" stroke="#FF4A6B" strokeWidth="3" opacity=".5" {...S} />
      <path d="M46 32h26" stroke="#FFF4E8" strokeWidth="3" opacity=".7" {...S} />
      <path d="M64 24l8 8-8 8" stroke="#FFF4E8" strokeWidth="3" opacity=".7" {...S} />
      <text x="23" y="63" fill="#22E6A0" fontSize="9" textAnchor="middle" fontFamily="monospace">
        LONG
      </text>
      <text x="97" y="63" fill="#FF4A6B" fontSize="9" textAnchor="middle" fontFamily="monospace">
        SHORT
      </text>
    </svg>
  );
}

function Perfect() {
  // Labelled, unlike the others: without them this is a cream square beside a gold stripe,
  // and which part of the candle pays — the one thing it has to teach — is left to guess.
  return (
    <svg viewBox="0 0 120 64" aria-hidden="true">
      <rect x="30" y="26" width="70" height="30" rx="7" fill="#4A4436" />
      <rect x="30" y="26" width="13" height="30" rx="6" fill="#FFCE5C" />
      <rect x="26" y="2" width="20" height="18" rx="5" fill="#FFF4E8" />
      <path d="M36 21v4" stroke="#FFCE5C" strokeWidth="2.4" strokeDasharray="1 4" {...S} />
      <text x="36" y="63" fill="#FFCE5C" fontSize="9" textAnchor="middle" fontFamily="monospace">
        LIP
      </text>
      <text x="74" y="63" fill="rgba(255,244,232,.4)" fontSize="9" textAnchor="middle" fontFamily="monospace">
        BODY
      </text>
    </svg>
  );
}

function Streak() {
  return (
    <svg viewBox="0 0 120 64" aria-hidden="true">
      {[
        ['×2', 4, 0.45],
        ['×5', 44, 0.7],
        ['×10', 84, 1],
      ].map(([t, x, o]) => (
        <g key={t as string} opacity={o as number}>
          <rect x={x as number} y="18" width="34" height="28" rx="8" fill="#FFCE5C" opacity=".16" />
          <text
            x={(x as number) + 17}
            y="37"
            fill="#FFCE5C"
            fontSize="14"
            textAnchor="middle"
            fontFamily="monospace"
          >
            {t as string}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Hedge() {
  return (
    <svg viewBox="0 0 120 64" aria-hidden="true">
      <rect x="50" y="2" width="20" height="20" rx="6" fill="#FFF4E8" />
      <path d="M60 24v8" stroke="#FFF4E8" strokeWidth="3" opacity=".5" {...S} />
      <path d="M36 36 h48 v6 c0 10 -12 18 -24 20 c-12 -2 -24 -10 -24 -20 z" fill="#6FB4FF" opacity=".85" />
    </svg>
  );
}

function Bell() {
  // The bar is the level, with the lit slice at the end. Two numbers on their own do not
  // say *when* — the bar is what makes it the end of something.
  return (
    <svg viewBox="0 0 120 64" aria-hidden="true">
      <text x="6" y="32" fill="#FFCE5C" fontSize="24" fontFamily="monospace">
        0:05
      </text>
      <text x="88" y="32" fill="#FFCE5C" fontSize="22" fontFamily="monospace">
        ×2
      </text>
      <rect x="6" y="44" width="108" height="7" rx="3.5" fill="#FFCE5C" opacity=".17" />
      <rect x="92" y="44" width="22" height="7" rx="3.5" fill="#FFCE5C" />
    </svg>
  );
}

const CARDS: { k: string; t: string; d: string; art: () => JSX.Element; c?: string }[] = [
  { k: 'JUMP', t: 'Tap, space or up', d: 'Tap again mid-air for a second jump.', art: Jump },
  {
    k: 'FLIP',
    t: 'Right side, or shift',
    d: 'Green wants you long. Red wants you short. Wrong side and the candle is not there.',
    art: Flip,
    c: 'var(--bear)',
  },
  {
    k: 'PERFECT',
    t: 'Land on the front lip',
    d: 'Pays a bonus and builds the streak.',
    art: Perfect,
    c: 'var(--gold)',
  },
  { k: 'STREAK', t: 'Chain landings', d: 'Clip a candle and it halves. Climbs to ×10.', art: Streak, c: 'var(--gold)' },
  { k: 'HEDGE', t: 'One free save', d: 'Catches you once and puts you back on the tape.', art: Hedge, c: 'var(--ice)' },
  { k: 'BELL', t: 'Last five seconds', d: 'Everything pays double and the tape speeds up.', art: Bell, c: 'var(--gold)' },
];

export function HowToPlay({ on, onBack }: { on: boolean; onBack: () => void }) {
  return (
    <section className={`scr howto${on ? ' on' : ''}`}>
      <div className="pan wide">
        <h2>How to play</h2>
        <div className="k" style={{ marginTop: 6 }}>
          THE TERRAIN IS A CANDLESTICK CHART
        </div>

        <div className="cards">
          {CARDS.map(({ k, t, d, art: Art, c }) => (
            <div className="card2" key={k}>
              <div className="art">
                <Art />
              </div>
              <div className="ck" style={c ? { color: c } : undefined}>
                {k}
              </div>
              <b>{t}</b>
              <span>{d}</span>
            </div>
          ))}
        </div>

        {/* The best thing in the game, and the thing nobody was told about. Given the whole
            width and drawn as the buttons it actually is. */}
        <div className="choice">
          <div className="ck" style={{ color: 'var(--bull)' }}>
            EVERY 25 SECONDS
          </div>
          <b>Bank it, or push</b>
          <span>
            Clear a level and the game stops and asks. The next one is faster and pays 25%
            more. Say nothing and it pushes for you.
          </span>
          <div className="choicebtns">
            <span className="fakebtn o">Back</span>
            <span className="fakebtn g">Continue</span>
          </div>
        </div>

        <button className="cta wide" onClick={onBack}>
          Got it
        </button>
      </div>
    </section>
  );
}
