# packages/contracts

Empty on purpose. Phase 3, and only if Phase 1 retention justifies it.

When it starts, it is a Foundry project for **settlement, not state**. No game logic, no
scores and no balances on chain — that costs real ETH gas and buys nothing. Prize
distribution via a Merkle distributor: one transaction a week to post the root, one
transaction per player to claim.

Four questions have to be answered before a line of Solidity is written. They are business
decisions, not engineering ones, and they are listed in
[../../docs/QUESTIONS-FOR-ALFA.md](../../docs/QUESTIONS-FOR-ALFA.md):

1. Paid tournament entry, or free entry with a sponsored pool? The former has real
   gambling-regulation exposure under Indonesian law.
2. Is $CANDLE its own token or a utility layer on $ROBIN?
3. Are characters and markets NFTs or database rows? Rows are correct for launch.
4. Who reviews flagged accounts?

One more, from this build: entitlement to anything redeemable must be computed from the
session table, not from the balance. Balance includes the one-time guest carry-over, which
is a client-reported number — bounded and capped, but not earned. Deriving claims from
balance would turn it into a mint. See QUESTIONS-FOR-ALFA #7.
