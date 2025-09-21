-- Ensure UUID helpers are available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Add authUserId to track Supabase auth UID and relate templates back to owners
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "authUserId" TEXT;

UPDATE "User" SET "authUserId" = COALESCE("authUserId", "id") WHERE "authUserId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "authUserId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'User_authUserId_key'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_authUserId_key" UNIQUE ("authUserId");
  END IF;
END
$$;

ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "ownerAuthId" TEXT;

DO $$
DECLARE
  fallback_auth_id TEXT;
BEGIN
  SELECT "authUserId"
    INTO fallback_auth_id
  FROM "User"
  ORDER BY "createdAt" ASC
  LIMIT 1;

  IF fallback_auth_id IS NULL THEN
    INSERT INTO "User" ("id", "authUserId", "email", "createdAt")
    VALUES (
      gen_random_uuid()::text,
      gen_random_uuid()::text,
      'placeholder-' || gen_random_uuid()::text || '@daygen.local',
      NOW()
    )
    RETURNING "authUserId" INTO fallback_auth_id;
  END IF;

  UPDATE "Template"
  SET "ownerAuthId" = COALESCE("ownerAuthId", fallback_auth_id);
END
$$;

ALTER TABLE "Template" ALTER COLUMN "ownerAuthId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Template_ownerAuthId_fkey'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE "Template"
      ADD CONSTRAINT "Template_ownerAuthId_fkey"
      FOREIGN KEY ("ownerAuthId") REFERENCES "User"("authUserId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "Template_ownerAuthId_idx" ON "Template"("ownerAuthId");
