-- A daily leaderboard that resets with nothing at stake is a scoreboard nobody opens
-- twice. These two tables are what turn the reset into an event: who won, what they were
-- paid, and a primary key on the day that makes paying it twice impossible.
CREATE TABLE "DailyClose" (
    "day"       TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entrants"  INTEGER NOT NULL DEFAULT 0,
    "paid"      INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "DailyClose_pkey" PRIMARY KEY ("day")
);

CREATE TABLE "DailyResult" (
    "id"       TEXT NOT NULL,
    "day"      TEXT NOT NULL,
    "rank"     INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "name"     TEXT NOT NULL,
    "score"    INTEGER NOT NULL,
    "prize"    INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "DailyResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyResult_day_rank_key" ON "DailyResult"("day", "rank");
CREATE INDEX "DailyResult_playerId_idx" ON "DailyResult"("playerId");

ALTER TABLE "DailyResult"
  ADD CONSTRAINT "DailyResult_day_fkey" FOREIGN KEY ("day")
  REFERENCES "DailyClose"("day") ON DELETE CASCADE ON UPDATE CASCADE;

-- Coming back tomorrow should be worth something to look at, even if it buys nothing.
ALTER TABLE "Player" ADD COLUMN "playStreak"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Player" ADD COLUMN "bestStreak"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Player" ADD COLUMN "lastPlayedOn" TEXT;
