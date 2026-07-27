# Brand

Four logo directions for Candle Rush. Open [`identity.html`](identity.html) — it is the
whole study: rationale, variants, scale tests and usage rules, in one self-contained file
with the typefaces embedded, so it opens with no network at all.

Nothing here is wired into the app yet. Pick one and the favicon, the app icon and the
store assets follow from it.

## The directions

| | Direction | What it is | Best for |
|---|---|---|---|
| 01 | **The Vault** | A gold candle on a continuous-corner tile, the next one opening in green behind it | App icon — recommended |
| 02 | **The Crest** | A gold shield with the candle cut clean out of it | Emblem, merch, one-colour |
| 03 | **The Signet** | A struck coin: double ring, rim type, C R with the candle in the gap | Avatar, token |
| 04 | **The Wordmark** | CANDLE in ink, RUSH in gold, the word space between them a candle | Header, title screen |

## What makes them read as metal

Three decisions carry the whole set. Break any of them and the marks stop matching.

- **Two highlights and a turn.** The gold runs light, turns dark at 62%, then catches a
  second highlight. One flat gradient is a yellow shape; the turn is what makes it gold.
- **A ground that lifts.** The tile is navy warming toward the top with a gold bloom behind
  the mark. On a flat fill the metal has nothing to sit against.
- **Green is always next.** Gold is the candle that closed, green is the one still open.
  Same rule the HUD follows.

Light comes from the top left in every mark. That is the only reason they sit together.

## Files

`svg/*.svg` — drawn at 512, resolution-free.

- `vault`, `vault-small` (drops the ghost candles for 32px and below), `vault-flat`
- `crest`, `crest-tile`
- `signet`, `signet-small` (drops the rim type, thickens the ring)
- `wordmark`, `wordmark-plain` (no kicker), `wordmark-light`
- `*-lockup`, `*-lockup-light` — icon plus wordmark

Wordmarks are outlined rather than set as live text, so the files carry no font dependency
and render identically on a machine that has never seen Archivo.

## Type

Archivo, weight 900, width 82 — narrow enough to be dense, heavy enough to hold a metal
fill without the gradient collapsing inside the strokes. Martian Mono stays for labels,
tickers and the signet's rim type.
