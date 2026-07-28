# Pons listing

Copy for the token page on [Pons](https://www.ponsfamily.com), the Robinhood Chain
launchpad. The form asks for a name, a ticker, a description, an image, a website and
social links. Two limits are documented: **name 32 characters, ticker 10**. The description
limit is not published, so there is a short version below that fits anywhere and a longer
one for if the field allows it.

Contract: `0xFd0030E7A1e3889a2Fd061311Db6180099f02d8C`

> **If the token is already deployed, the name and ticker are fixed on-chain.** Use whatever
> is already there and take only the description and the links from this file — a listing
> whose ticker disagrees with the contract reads as a copy of somebody else's token.

---

## The fields

| Field | Value | |
|---|---|---|
| Name | `Candle Rush` | 11 / 32 |
| Ticker | see below | |
| Image | `docs/brand/social/x-avatar-400.png` | 400×400, already square |
| Website | `https://candlerush.fun` | |
| X | `https://x.com/Playcandlerush` | |
| Telegram | — | Leave empty rather than pointing at a group that does not exist yet |

### Ticker

Only if it is not already set on-chain.

| | | |
|---|---|---|
| `CRUSH` | 5 | **Recommended.** It is inside the name — Candle **RUSH** — so it is a pun that explains itself, and it is far more searchable than the other two. |
| `RUSH` | 4 | Short and clean, but a common word; you will be competing with every other RUSH in every search box forever. |
| `CANDLE` | 6 | The obvious one, and obvious is the problem. It says "a candle token" rather than the name of this game. |

---

## Description

### Short — 225 characters, safe for any field

> An endless runner where the terrain is a candlestick chart. Land on the bodies, fall
> through the gaps, and every 25 seconds decide: bank what you've made, or push for a level
> that pays 25% more. Free to play at candlerush.fun

### Shorter — 130, if the field is tight

> An endless runner where the terrain is a candlestick chart. Every 25 seconds it asks: bank
> it, or push. Playable at candlerush.fun

### Long — 561, if there is room

> An endless runner where the terrain is a candlestick chart. You land on the bodies, fall
> through the gaps, and flip long or short to match the tape.
>
> Levels last 25 seconds. Clear one and the game stops and asks whether you want to bank
> what you have made or push for a level that is faster and pays 25% more.
>
> Scores are verified rather than reported: every run submits its seed and its inputs, the
> server re-simulates the whole thing frame by frame, and every run gets a public link
> anyone can watch back.
>
> Free, in a browser, no wallet needed: candlerush.fun

The last paragraph is the one worth the characters. Every other token on the page is a
description of something that does not exist yet.

---

## The launch post

The X thread is in [`launch.md`](launch.md) and works unchanged. This is the Pons-specific
opener — use it instead of the pinned post there if the launch is being announced *as* a
Pons launch.

> $TICKER is live on Pons.
>
> CA: `0xFd0030E7A1e3889a2Fd061311Db6180099f02d8C`
>
> Candle Rush is an endless runner where the terrain is a candlestick chart. It has been
> playable at candlerush.fun this whole time — free, no wallet, no sign-up.
>
> Play it first. Then decide.

272 characters with the address counted in full.

---

## What you can say about the launch itself

Pons launches are fixed-supply and non-custodial: there is no mint function for a creator
to call afterwards, and trades settle from the buyer's own wallet rather than through
deposits the team holds. Liquidity graduates and locks.

**Check the token page and confirm each of those for this contract before repeating any of
them.** They are properties of how Pons works, not promises this project made, and the
moment one of them is stated slightly wrong it becomes the only thing anyone remembers. The
useful version is the one that points at where to look:

> Fixed supply, no mint function, non-custodial — that is how Pons launches work, not
> something I'm asking you to take my word for. It is on the token page.

---

## Still do not say

Everything in the [`launch.md`](launch.md) "Do not say" list applies here without change.
The one worth repeating, because a launchpad page is exactly where it gets typed:

**The in-game balance is points, not the token.** Nothing on-chain touches the ledger,
the stakes or the daily prizes. If that ever changes, the description changes on the day it
ships and not a day earlier.
