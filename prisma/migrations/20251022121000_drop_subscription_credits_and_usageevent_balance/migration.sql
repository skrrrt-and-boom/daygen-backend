-- Drop Subscription.credits (ensure code no longer reads it)
ALTER TABLE "Subscription" DROP COLUMN IF EXISTS "credits";

-- Optionally drop UsageEvent.balanceAfter later after full ledger switch; keeping for now
-- ALTER TABLE "UsageEvent" DROP COLUMN IF EXISTS "balanceAfter";
