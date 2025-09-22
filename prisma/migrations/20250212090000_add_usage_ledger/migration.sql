-- Create UsageStatus enum if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'UsageStatus'
  ) THEN
    CREATE TYPE "UsageStatus" AS ENUM ('COMPLETED', 'GRACE');
  END IF;
END
$$;

-- Create UsageEvent table
CREATE TABLE IF NOT EXISTS "UsageEvent" (
  "id"           TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userAuthId"   TEXT         NOT NULL,
  "provider"     TEXT         NOT NULL,
  "model"        TEXT,
  "prompt"       TEXT,
  "cost"         INTEGER      NOT NULL,
  "balanceAfter" INTEGER      NOT NULL,
  "status"       "UsageStatus" NOT NULL DEFAULT 'COMPLETED',
  "metadata"     JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

-- Ensure foreign key to User.authUserId exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'UsageEvent_userAuthId_fkey'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE "UsageEvent"
      ADD CONSTRAINT "UsageEvent_userAuthId_fkey"
      FOREIGN KEY ("userAuthId") REFERENCES "User"("authUserId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- Index to speed up querying by user and time
CREATE INDEX IF NOT EXISTS "UsageEvent_userAuthId_createdAt_idx"
  ON "UsageEvent" ("userAuthId", "createdAt" DESC);
