-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'SUBMITTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('SESSION_PAYOUT', 'UNLOCK_PURCHASE', 'TOURNAMENT_PRIZE', 'ADJUSTMENT', 'GUEST_MIGRATION');

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activeChar" TEXT NOT NULL DEFAULT 'bull',
    "activeMap" TEXT NOT NULL DEFAULT 'dawn',
    "unlockedChars" TEXT[] DEFAULT ARRAY['bull']::TEXT[],
    "unlockedMaps" TEXT[] DEFAULT ARRAY['dawn']::TEXT[],
    "bestSession" INTEGER NOT NULL DEFAULT 0,
    "totalSessions" INTEGER NOT NULL DEFAULT 0,
    "handicap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "mapId" TEXT NOT NULL,
    "charId" TEXT NOT NULL,
    "handicap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engineVersion" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "serverScore" INTEGER,
    "clientScore" INTEGER,
    "candles" INTEGER,
    "bestMult" INTEGER,
    "cleanFlips" INTEGER,
    "inputCount" INTEGER,
    "inputJitterMs" DOUBLE PRECISION,
    "frames" INTEGER,
    "endReason" TEXT,
    "wallClockMs" INTEGER,
    "replay" JSONB,
    "serverDigest" TEXT,
    "clientDigest" TEXT,
    "rejectReason" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_address_key" ON "Player"("address");

-- CreateIndex
CREATE INDEX "Player_bestSession_idx" ON "Player"("bestSession");

-- CreateIndex
CREATE INDEX "Session_playerId_submittedAt_idx" ON "Session"("playerId", "submittedAt");

-- CreateIndex
CREATE INDEX "Session_status_issuedAt_idx" ON "Session"("status", "issuedAt");

-- CreateIndex
CREATE INDEX "Session_submittedAt_idx" ON "Session"("submittedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_playerId_createdAt_idx" ON "LedgerEntry"("playerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_refType_refId_kind_key" ON "LedgerEntry"("refType", "refId", "kind");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

