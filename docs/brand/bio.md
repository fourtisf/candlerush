# Bio and short descriptions

One idea, at five lengths. They all say the same thing because a description that changes
between the X bio and the site is two products as far as a reader is concerned.

The idea: **the chart is the level.** Everything else is a detail that earns its place or
gets cut.

---

## X bio — 160 characters

Use the **Website** field for the link. It renders as its own line under the bio and costs
you nothing, so spending 14 of 160 characters on `candlerush.fun` is 14 characters of
description thrown away.

### Recommended

> An endless runner where the terrain is a candlestick chart. Land the bodies, clear the
> gaps. Every 25 seconds it asks: bank it, or push.

136 characters. It says what it is, how it moves, and what the decision is — and the
decision is the only part that makes anyone curious.

### If the audience is crypto-first

> An endless runner on a live candlestick chart. Every score is replayed by the server, and
> every run has a public link you can watch back.

137. Leads with the thing nobody else on the timeline can claim. Weaker as a description of
the game, stronger as a reason to trust the board.

### If it needs to be shorter

> The chart is the level. Land on the bodies, fall through the gaps, bank it or push.

83. For anywhere with less room, or when the profile already has a banner doing the
explaining.

### Other fields

| Field | Value |
|---|---|
| Name (50) | `Candle Rush` |
| Website | `https://candlerush.fun` |
| Location | Leave it empty. A fake city reads as a fake account. |

---

## Site meta description — 155 characters

Already shipped in `apps/web/app/layout.tsx`; kept here so it does not drift.

> Ride the candles, bank the close. A levelled endless runner where the terrain is a
> candlestick chart.

101. Short for the slot on purpose — Google truncates around 155 and a description that
ends mid-sentence looks abandoned.

---

## Telegram / Discord — 255 characters

> An endless runner where the terrain is a live candlestick chart. Land on the bodies, flip
> long or short, and every 25 seconds decide whether to bank what you've made or push for a
> level that pays 25% more.
>
> Free, no wallet: candlerush.fun

---

## Listings and aggregators

Most of them want one sentence and then a paragraph. Give them both.

**One sentence**

> Candle Rush is a browser arcade game where the terrain is a candlestick chart — free to
> play, no wallet required.

**Paragraph**

> Candle Rush is an endless runner where the terrain is a live candlestick chart. You land
> on the bodies, fall through the gaps, and flip long or short to match the tape. Levels
> last 25 seconds; clear one and the game stops to ask whether you want to bank what you
> have made or push for a level that is faster and pays 25% more.
>
> Every score is verified rather than reported: each run submits its seed and its input
> tape, the server re-simulates the whole thing frame for frame, and only the number the
> server computes is banked. Every run has a public link, so any score on the board can be
> watched back.
>
> It runs in a browser, on a phone or a desktop, free and without a wallet.

---

## Rules these follow

- **No adjectives that a competitor could also use.** "Addictive", "fast-paced", "unique",
  "immersive" — every one of them appears in a thousand other bios and describes none of
  them. "The terrain is a candlestick chart" cannot be borrowed.
- **No claim the game does not enforce.** Every number here is in the engine: 25 seconds,
  25% more, ×10, five seconds.
- **Nothing about the token in the bio.** A bio that leads with a ticker tells a reader the
  game is the marketing. Leading with the game tells them the opposite, and the opposite
  happens to be true.
- **No emoji in the bio.** The wordmark and the avatar are doing that work, and they are
  doing it better.
