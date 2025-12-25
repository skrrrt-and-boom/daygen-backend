-- Fix apply_credit_delta function security and search_path
-- Adds SECURITY DEFINER and sets search_path to public

CREATE OR REPLACE FUNCTION public.apply_credit_delta(
  user_auth_id TEXT,
  delta BIGINT,
  reason TEXT,
  source_type TEXT,
  source_id TEXT,
  provider TEXT,
  model TEXT,
  prompt_hash TEXT,
  meta JSONB
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_credits BIGINT;
  new_balance BIGINT;
  grace INTEGER := 0; -- UsageService enforces grace externally; keep 0 here
BEGIN
  -- Lock the user row to prevent race conditions
  SELECT "credits" INTO current_credits
  FROM "User"
  WHERE "authUserId" = user_auth_id
  FOR UPDATE;

  IF current_credits IS NULL THEN
    RAISE EXCEPTION 'User not found for credit delta';
  END IF;

  new_balance := current_credits + delta;
  IF new_balance < -grace THEN
    RAISE EXCEPTION 'Insufficient credits to apply delta: % (grace=%)', delta, grace;
  END IF;

  UPDATE "User" SET "credits" = new_balance WHERE "authUserId" = user_auth_id;

  -- Optional: write to ledger if table exists (intentionally omitted to avoid dependency)

  RETURN new_balance;
END;
$$;
