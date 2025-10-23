-- Create enums if not exist
DO $$ BEGIN
  CREATE TYPE "CreditReason" AS ENUM ('JOB','PAYMENT','REFUND','ADJUSTMENT','SUBSCRIPTION_CYCLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CreditSourceType" AS ENUM ('JOB','PAYMENT','SUBSCRIPTION_CYCLE','SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Plan table
CREATE TABLE IF NOT EXISTS "Plan" (
  "id" TEXT NOT NULL DEFAULT (cuid()),
  "name" TEXT NOT NULL,
  "interval" TEXT NOT NULL,
  "creditsPerPeriod" INTEGER NOT NULL,
  "graceCredits" INTEGER NOT NULL DEFAULT 0,
  "stripePriceId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Plan_stripePriceId_key" ON "Plan"("stripePriceId");

-- SubscriptionCycle table
CREATE TABLE IF NOT EXISTS "SubscriptionCycle" (
  "id" TEXT NOT NULL DEFAULT (cuid()),
  "subscriptionId" TEXT NOT NULL,
  "stripeInvoiceId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "creditsGranted" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionCycle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionCycle_stripeInvoiceId_key" ON "SubscriptionCycle"("stripeInvoiceId");
CREATE INDEX IF NOT EXISTS "SubscriptionCycle_subscriptionId_periodStart_idx" ON "SubscriptionCycle"("subscriptionId", "periodStart");

ALTER TABLE "SubscriptionCycle"
  ADD CONSTRAINT "SubscriptionCycle_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreditLedger table
CREATE TABLE IF NOT EXISTS "CreditLedger" (
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "userId" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "reason" "CreditReason" NOT NULL,
  "sourceType" "CreditSourceType" NOT NULL,
  "sourceId" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "promptHash" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CreditLedger_userId_createdAt_idx" ON "CreditLedger"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "CreditLedger_source_idx" ON "CreditLedger"("sourceType", "sourceId");

ALTER TABLE "CreditLedger"
  ADD CONSTRAINT "CreditLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("authUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Function to apply credit delta atomically with per-plan grace enforcement
CREATE OR REPLACE FUNCTION public.apply_credit_delta(
  user_auth_id TEXT,
  delta INTEGER,
  reason "CreditReason",
  source_type "CreditSourceType",
  source_id TEXT,
  provider TEXT,
  model TEXT,
  prompt_hash TEXT,
  meta JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_credits INTEGER;
  new_balance INTEGER;
  grace INTEGER;
BEGIN
  SELECT "credits" INTO current_credits FROM "User" WHERE "authUserId" = user_auth_id FOR UPDATE;
  IF current_credits IS NULL THEN
    RAISE EXCEPTION 'User not found for credit delta';
  END IF;

  SELECT COALESCE(p."graceCredits", 0) INTO grace
  FROM "Subscription" s
  JOIN "Plan" p ON p."stripePriceId" = s."stripePriceId"
  WHERE s."userId" = user_auth_id
  LIMIT 1;
  IF grace IS NULL THEN
    grace := 0;
  END IF;

  new_balance := current_credits + delta;
  IF new_balance < -grace THEN
    RAISE EXCEPTION 'Insufficient credits to apply delta: % (grace=%)', delta, grace;
  END IF;

  UPDATE "User" SET "credits" = new_balance WHERE "authUserId" = user_auth_id;

  INSERT INTO "CreditLedger"(
    "userId", "delta", "balanceAfter", "reason", "sourceType", "sourceId", "provider", "model", "promptHash", "metadata", "createdAt"
  ) VALUES (
    user_auth_id, delta, new_balance, reason, source_type, source_id, provider, model, prompt_hash, meta, NOW()
  );

  RETURN new_balance;
END;
$$;


