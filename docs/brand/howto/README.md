# How to play — banners

Eight images at **1600×900**. That is 16:9, which is what X crops an in-feed image to;
anything else gets cropped for you, and usually through the headline.

| File | Use |
|---|---|
| `00-how-to-play.png` | The whole game on one image. Pin it. |
| `01-jump.png` … `07-bank-or-push.png` | A thread, one mechanic per post, in order. |

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
