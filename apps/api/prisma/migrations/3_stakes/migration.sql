-- Stake-to-play: a balance is something you risk on a run rather than something that only
-- ever accumulates. Existing rows are paper stakes, which is what they were played as.
ALTER TABLE "Session" ADD COLUMN "stakeId"      TEXT             NOT NULL DEFAULT 'paper';
ALTER TABLE "Session" ADD COLUMN "stakeCost"    INTEGER          NOT NULL DEFAULT 0;
ALTER TABLE "Session" ADD COLUMN "stakeMult"    DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "Session" ADD COLUMN "stakeSettled" BOOLEAN          NOT NULL DEFAULT false;

-- Nothing before this migration held a stake, so every past session is already settled as
-- far as the refund sweep is concerned. Saying so explicitly keeps the sweep from ever
-- looking at them.
UPDATE "Session" SET "stakeSettled" = true;

ALTER TYPE "SessionStatus" ADD VALUE 'ABANDONED';

ALTER TYPE "LedgerKind" ADD VALUE 'SESSION_STAKE';
ALTER TYPE "LedgerKind" ADD VALUE 'SESSION_REFUND';
ALTER TYPE "LedgerKind" ADD VALUE 'DAILY_PRIZE';
