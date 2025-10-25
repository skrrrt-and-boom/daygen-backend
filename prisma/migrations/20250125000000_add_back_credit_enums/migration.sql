-- Add back the CreditReason and CreditSourceType enums that were removed but are still needed by the code

-- Create CreditReason enum
DO $$ BEGIN
  CREATE TYPE "CreditReason" AS ENUM ('JOB','PAYMENT','REFUND','ADJUSTMENT','SUBSCRIPTION_CYCLE');
EXCEPTION WHEN duplicate_object THEN NULL; 
END $$;

-- Create CreditSourceType enum  
DO $$ BEGIN
  CREATE TYPE "CreditSourceType" AS ENUM ('JOB','PAYMENT','SUBSCRIPTION_CYCLE','SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; 
END $$;

-- Update the apply_credit_delta function to accept string parameters instead of enum types
CREATE OR REPLACE FUNCTION public.apply_credit_delta(
  user_auth_id TEXT,
  delta INTEGER,
  reason TEXT,
  source_type TEXT,
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

  -- Note: We're not inserting into CreditLedger since that table was removed
  -- This is a simplified version that just updates the user's credit balance

  RETURN new_balance;
END;
$$;
