# How to play — banners

Five images at **1600×900**. That is 16:9, which is what X crops an in-feed image to;
anything else gets cropped for you, and usually through the headline.

| File | Use |
|---|---|
| `00-how-to-play.png` | The whole game on one image. Pin it. |
| `01-controls.png` | Jump and flip. |
| `02-scoring.png` | The lip, and the streak it builds. |
| `03-survival.png` | The hedge, and the closing bell. |
| `04-bank-or-push.png` | The choice. |

`01`–`04` are a thread, in that order.

### Why four and not seven

One mechanic per card is the tidy way to cut this up and the wrong way to post it. Nobody
reads seven images, and a reader who drops out at four never reaches the one thing that
actually sells the game — so the six mechanics are grouped into how you move, how you
score and how you survive, two figures to a card, and the choice keeps a card to itself
because it is the hook.

Adding a card means taking one away.

## Rebuilding

```
node docs/brand/howto/build.mjs
```

Chromium rasterises them and the typefaces are embedded as data URIs, so it runs with no
network at all. `OUT_DIR` moves the output; `CR_CHROMIUM` points at a browser if the
default path is wrong.

## The rules it follows

Everything here comes from [`../README.md`](../README.md) — the gold turns dark at 62% and
catches a second highlight, the ground lifts behind the mark, and green is always the
candle still open. Break those and the banners stop matching the app.

Two more that are specific to this set:

- **The figures are the game's figures.** `art.mjs` and
  `apps/web/components/ui/HowToPlay.tsx` draw the same six shapes in the same 120×64 box.
  Somebody who learns the game from a post should recognise the panel they meet in the
  game — and a mechanic redrawn twice ends up explained two different ways. Change one,
  change both.
- **The words are the buttons' words.** The last card shows BACK and CONTINUE because that
  is what the level panel says. A banner that teaches a label the game does not use is
  worse than no banner.

## Copy

The headline is Bricolage at 88px and the body is Martian Mono at 20px. The body wants
three or four lines; at five the tape starts running through the last one, and a candle
drawn across a sentence costs the sentence more than it gains the picture.
