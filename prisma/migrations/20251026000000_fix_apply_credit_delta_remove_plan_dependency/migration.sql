-- Fix apply_credit_delta function to remove Plan table dependency
-- The Plan table was removed but the function still references it
-- This update removes the JOIN to Plan and uses a simple grace credits approach

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

  INSERT INTO "CreditLedger"(
    "userId", "delta", "balanceAfter", "reason", "sourceType", "sourceId", "provider", "model", "promptHash", "metadata", "createdAt"
  ) VALUES (
    user_auth_id, delta, new_balance, reason, source_type, source_id, provider, model, prompt_hash, meta, NOW()
  );

  RETURN new_balance;
END;
$$;

