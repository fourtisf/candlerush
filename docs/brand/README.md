# Brand

Five logo directions for Candle Rush. Open [`identity.html`](identity.html) — it is the
whole study: rationale, colourways, scale tests and usage rules, in one self-contained file
with the typefaces embedded, so it opens with no network at all.

Nothing here is wired into the app yet. These are proposals; pick one and the favicon,
the app icon and the store assets follow from it.

## The concepts

| | Direction | What it is | Best for |
|---|---|---|---|
| 01 | **The Ladder** | Three candles stepping up, last wick out of frame | App icon — recommended |
| 02 | **Wordspace Wick** | The space between CANDLE and RUSH *is* a candle | Wordmark, headers |
| 03 | **Doji Seal** | One doji in a ring | Avatar, token, sticker |
| 04 | **The Hop** | The jump arc between two candle tops | Tutorial, social |
| 05 | **Tape Speed** | Sheared candles with motion streaks | Store hero, campaign |

## Files

`svg/<concept>-<part>-<colourway>.svg`

- **parts** — `icon`, `lockup`, `small` (a redrawn cut for 32px and below), `stacked`
- **colourways** — `dark` (on `#06081C`), `light` (on white or paper), `mono`

The `mono` files paint with `currentColor`, so they take the colour of whatever element
they are dropped into — one file covers every one-colour use.

Wordmarks are outlined, not live text. The logo files therefore carry no font dependency
and render identically on a machine that has never seen Bricolage Grotesque.

## Rebuilding

`../../` has no build step for these — they were generated once by the scripts recorded in
the study. To change a mark, edit the SVG directly; the geometry is plain rects and one
`<path>` per word.

Two rules the geometry holds across every mark, worth keeping if you extend the set:

- body corner radius is **28%** of body width
- the wick is **15%** of body width at **50%** opacity

And one rule for lockups: **never two candles**. If the icon carries a candle, the wordmark
is plain; if the wordmark carries one (concept 02), there is no icon.
