-- Update apply_credit_delta function to match the actual parameter types being passed
-- The error shows: (text, bigint, "CreditReason", "CreditSourceType", unknown, text, text, unknown, jsonb)
-- We need to change INTEGER to BIGINT and allow unknown for NULL parameters

DROP FUNCTION IF EXISTS public.apply_credit_delta CASCADE;

CREATE OR REPLACE FUNCTION public.apply_credit_delta(
  user_auth_id TEXT,
  delta BIGINT,              -- Changed from INTEGER to BIGINT to match what's being passed
  reason "CreditReason",
  source_type "CreditSourceType",
  source_id TEXT,
  provider TEXT,
  model TEXT,
  prompt_hash TEXT,
  meta JSONB
) RETURNS BIGINT
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

