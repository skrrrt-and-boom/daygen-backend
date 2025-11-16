-- Drop ALL versions of apply_credit_delta to clear any enum-based signatures
DROP FUNCTION IF EXISTS public.apply_credit_delta;

-- Now create the function fresh with TEXT parameters only
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

