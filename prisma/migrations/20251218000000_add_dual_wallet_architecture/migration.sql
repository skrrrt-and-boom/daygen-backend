-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('SUBSCRIPTION', 'TOPUP');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT', 'RESET', 'REFUND', 'EXPIRATION');

-- CreateTable
CREATE TABLE "UserWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionCredits" INTEGER NOT NULL DEFAULT 0,
    "subscriptionExpiresAt" TIMESTAMP(3),
    "topUpCredits" INTEGER NOT NULL DEFAULT 0,
    "graceLimit" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletType" "WalletType" NOT NULL,
    "transactionType" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserWallet_userId_key" ON "UserWallet"("userId");

-- CreateIndex
CREATE INDEX "UserWallet_userId_idx" ON "UserWallet"("userId");

-- CreateIndex
CREATE INDEX "WalletTransaction_userId_createdAt_idx" ON "WalletTransaction"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WalletTransaction_sourceType_sourceId_idx" ON "WalletTransaction"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "UserWallet" ADD CONSTRAINT "UserWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("authUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing users: Create wallet for each user
-- Move existing credits to top-up wallet (safest: treat existing as perpetual)
INSERT INTO "UserWallet" ("id", "userId", "topUpCredits", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    "authUserId",
    GREATEST("credits", 0),
    NOW(),
    NOW()
FROM "User"
ON CONFLICT ("userId") DO NOTHING;

-- For users with active subscriptions, populate subscription credits from their plan
-- This assumes subscription.credits contains the plan limit
UPDATE "UserWallet" w
SET 
    "subscriptionCredits" = COALESCE(s."credits", 0),
    "subscriptionExpiresAt" = s."currentPeriodEnd"
FROM "Subscription" s
WHERE s."userId" = w."userId"
  AND s."status" = 'ACTIVE';
