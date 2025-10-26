-- Create the enum types if they don't exist
DO $$ BEGIN
  CREATE TYPE "CreditReason" AS ENUM ('JOB','PAYMENT','REFUND','ADJUSTMENT','SUBSCRIPTION_CYCLE');
EXCEPTION WHEN duplicate_object THEN NULL; 
END $$;

DO $$ BEGIN
  CREATE TYPE "CreditSourceType" AS ENUM ('JOB','PAYMENT','SUBSCRIPTION_CYCLE','SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; 
END $$;

-- Drop ALL versions of the function with CASCADE to force removal
DROP FUNCTION IF EXISTS public.apply_credit_delta CASCADE;

-- Create the function with enum types (as expected by the codebase)
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
  grace INTEGER := 0;
BEGIN
  SELECT "credits" INTO current_credits FROM "User" WHERE "authUserId" = user_auth_id FOR UPDATE;
  IF current_credits IS NULL THEN
    RAISE EXCEPTION 'User not found for credit delta';
  END IF;

  new_balance := current_credits + delta;
  IF new_balance < -grace THEN
    RAISE EXCEPTION 'Insufficient credits to apply delta: % (grace=%)', delta, grace;
  END IF;

  UPDATE "User" SET "credits" = new_balance WHERE "authUserId" = user_auth_id;

  RETURN new_balance;
END;
$$;

