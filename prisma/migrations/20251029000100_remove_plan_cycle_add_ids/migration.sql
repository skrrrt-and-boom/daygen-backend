-- Safe migration to align DB with metered billing and in-code plans

-- 1) Remove Plan relation and table
ALTER TABLE "Subscription" DROP CONSTRAINT IF EXISTS "Subscription_planId_fkey";
ALTER TABLE "Subscription" DROP COLUMN IF EXISTS "planId";
DROP INDEX IF EXISTS "Subscription_planId_idx";
DROP TABLE IF EXISTS "Plan";

-- 2) Remove SubscriptionCycle table (cycles are represented by Stripe invoices)
DROP TABLE IF EXISTS "SubscriptionCycle";

-- 3) Add identifiers for metered billing
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
DO $$ BEGIN
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "User_stripeCustomerId_key" ON "User" ("stripeCustomerId")';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "stripeSubscriptionItemId" TEXT;
DO $$ BEGIN
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_stripeSubscriptionItemId_key" ON "Subscription" ("stripeSubscriptionItemId")';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

ALTER TABLE "UsageEvent" ADD COLUMN IF NOT EXISTS "stripeUsageRecordId" TEXT;
DO $$ BEGIN
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "UsageEvent_stripeUsageRecordId_key" ON "UsageEvent" ("stripeUsageRecordId")';
EXCEPTION WHEN OTHERS THEN NULL; END $$;


