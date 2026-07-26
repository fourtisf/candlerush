# Candle Rush

A single-file HTML5 arcade runner played on a candlestick chart. Ninety seconds a
session: ride the candles, collect pips, and bank whatever P&L is on the table when
the closing bell rings.

Everything — rendering, audio, generation, UI — lives in `index.html`. No build step,
no dependencies, no bundler. Open the file and it runs.

## Play

Open `index.html` in a browser, or serve the directory:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Jump / double jump | `Space` · `W` · `↑` | Tap left half |
| Flip long ↔ short | `Shift` · `S` · `↓` · `E` | Tap right half |
| Pause | `P` · `Esc` | Pause chip |
| Mute | `M` | Sound chip |

Releasing the jump key early cuts the jump short.

## How it works

**Position matters.** Green candles are solid only while you're long; red candles are
solid only while you're short. Everything on the wrong side of your position renders
as a dashed, crossed-out hole and you fall straight through it. Gold doji candles are
always solid, which makes them the bridges you flip on — the ones that need a flip are
marked with a pulsing `FLIP` arrow. The candle you're currently standing on never
drops out from under you, so a mistimed flip costs you the tape ahead, not your footing.

**The clock.** A session is 90 seconds. At 20 seconds remaining the closing bell fires
and all P&L doubles for the rest of the run. Land the edge of a candle for a perfect
bounce bonus; chain landings for a streak multiplier up to ×10. Stumbling into a wall
halves it.

**Liquidation.** Fall off the chart and you're liquidated. Once per session (after 12
candles cleared) you can add margin to keep trading — you get a fresh doji runway, a
free stop loss, and your P&L intact.

**Pickups.** Pips are the small gold P&L drops. Powerups are Leverage (2× for 10s),
Stop Loss (one free save from a fall), and Momentum (4.5s of auto-flight above the tape).

**Regimes.** The generator cycles through DRIFT, BREAKOUT, SELL-OFF, and CHOP, each with
its own run length, slope range, gap frequency, and speed. Markets weight these
differently, and the game quietly adjusts difficulty based on your last few sessions.

## Traders

Each is a distinct hand-drawn canvas sprite, not a recolour.

| Trader | Cost | Perk |
| --- | --- | --- |
| Bull | free | Steady. Nothing special. |
| Bear | $20K | Opens every session short. |
| Fox | $50K | Market speeds up 30% slower. |
| Whale | $120K | Double pip reach, +30% pip value. |
| Ape | $250K | A third jump in the air. |
| Diamond | $500K | Free stop loss every session. |

## Markets

Each market is a different world *and* a different ruleset — background, palette,
ambient particles, chop, and payout multiplier all change.

| Market | Cost | Payout | Ruleset |
| --- | --- | --- | --- |
| Dawn | free | 1.0× | Long only. No shorting, no holes. Learn the tape. |
| Night | $40K | 1.3× | Shorting opens up. Calm trends, long doji bridges. |
| Red Sea | $150K | 1.6× | Bleeding tape. You will live in short. |
| Gold Rush | $400K | 2.0× | Melt-up. Fast, choppy, pip-rich. |

Session P&L is credited to your account balance, which is what unlocks traders and
markets.

## Notes

- Progress (name, balance, unlocks, best session) is saved through a host-provided
  `window.storage` API. When that API isn't present — which is the case in a plain
  browser — the save silently no-ops and progress lasts only for the page session.
- The wallet button uses `window.ethereum` when available and otherwise fills in a
  demo address. It's cosmetic; nothing on-chain happens and a wallet is never required.
- Respects `prefers-reduced-motion`.
