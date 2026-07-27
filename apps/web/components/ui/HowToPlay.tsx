'use client';

/**
 * The rules, written down.
 *
 * Nothing here was discoverable. A new player was never told that the candle colour
 * decides which way they have to be facing, that the leading edge of a candle pays extra,
 * that a stumble halves the multiplier, or that clearing a level is a decision rather than
 * a cutscene. That last one is the best thing in the game and it was invisible.
 */
const RULES: { k: string; t: string; d: string; c?: string }[] = [
  {
    k: 'JUMP',
    t: 'Tap, space or up',
    d: 'Tap again in the air for a second jump. Let go early to jump shorter — the height is yours to control.',
  },
  {
    k: 'FLIP',
    t: 'Right half of the screen, or shift',
    d: 'Green candles need you long, red candles need you short. Stand on the wrong side of the tape and the candle is not there to land on.',
    c: 'var(--bear)',
  },
  {
    k: 'PERFECT',
    t: 'Land on the leading edge',
    d: 'The front lip of a candle pays a bonus and builds your streak. Three landings in a row is ×2, and it climbs to ×10.',
    c: 'var(--gold)',
  },
  {
    k: 'STUMBLE',
    t: 'Clipping a candle halves it',
    d: 'You do not die, but the multiplier is cut in half and has to be rebuilt. Falling off the chart is what kills you.',
  },
  {
    k: 'HEDGE',
    t: 'One free save',
    d: 'A hedge catches you once and puts you back on the tape. Pick them up mid-run, or start every run with one as the Diamond.',
    c: 'var(--ice)',
  },
  {
    k: 'BELL',
    t: 'The last five seconds pay double',
    d: 'Every level ends with a closing bell. The tape speeds up and everything is worth twice as much.',
    c: 'var(--gold)',
  },
  {
    k: 'THE CHOICE',
    t: 'Bank it, or push',
    d: 'Clear a level and the game stops and asks. Back takes the money and ends the run. Continue goes into a faster level that pays 25% more. Say nothing and it continues for you.',
    c: 'var(--bull)',
  },
];

export function HowToPlay({ on, onBack }: { on: boolean; onBack: () => void }) {
  return (
    <section className={`scr${on ? ' on' : ''}`}>
      <div className="pan">
        <h2>How to play</h2>
        <div className="k" style={{ marginTop: 8 }}>
          THE TERRAIN IS A CANDLESTICK CHART
        </div>
        <div className="rules">
          {RULES.map((r) => (
            <div className="rule2" key={r.k}>
              <div className="rk" style={r.c ? { color: r.c } : undefined}>
                {r.k}
              </div>
              <div className="rb">
                <b>{r.t}</b>
                <span>{r.d}</span>
              </div>
            </div>
          ))}
        </div>
        <button className="cta wide" onClick={onBack}>
          Got it
        </button>
      </div>
    </section>
  );
}
