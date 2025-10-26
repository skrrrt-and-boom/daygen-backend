-- Remove unnecessary tables
DROP TABLE IF EXISTS "CreditLedger" CASCADE;
DROP TABLE IF EXISTS "SubscriptionCycle" CASCADE;
DROP TABLE IF EXISTS "Plan" CASCADE;

-- Remove the CreditReason and CreditSourceType enums as they're no longer needed
DROP TYPE IF EXISTS "CreditReason" CASCADE;
DROP TYPE IF EXISTS "CreditSourceType" CASCADE;
