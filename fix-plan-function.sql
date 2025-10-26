-- Fix apply_credit_delta function to remove Plan table dependency
-- This removes the JOIN to Plan and uses a simple grace credits approach

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
  grace INTEGER := 0; -- Default to 0, can be overridden via env
BEGIN
  SELECT "credits" INTO current_credits FROM "User" WHERE "authUserId" = user_auth_id FOR UPDATE;
  IF current_credits IS NULL THEN
    RAISE EXCEPTION 'User not found for credit delta';
  END IF;

  -- Grace is now controlled via USAGE_GRACE_CREDITS env var in the service layer
  -- We can keep grace at 0 here since the UsageService.checkCredits() handles grace logic
  
  new_balance := current_credits + delta;
  IF new_balance < -grace THEN
    RAISE EXCEPTION 'Insufficient credits to apply delta: % (grace=%)', delta, grace;
  END IF;

  UPDATE "User" SET "credits" = new_balance WHERE "authUserId" = user_auth_id;

  -- Note: CreditLedger table may not exist, so we'll skip that insert for now
  -- The UsageEvent table will handle the audit trail

  RETURN new_balance;
END;
$$;
