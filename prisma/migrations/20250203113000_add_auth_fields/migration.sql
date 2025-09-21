-- Add authUserId to track Supabase auth UID and relate templates back to owners
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "authUserId" TEXT;

UPDATE "User" SET "authUserId" = COALESCE("authUserId", "id") WHERE "authUserId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "authUserId" SET NOT NULL;

ALTER TABLE "User" ADD CONSTRAINT IF NOT EXISTS "User_authUserId_key" UNIQUE ("authUserId");

-- Ensure Template rows can be associated to owners through authUserId
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "ownerAuthId" TEXT;

-- NOTE: If legacy template rows exist, backfill ownerAuthId before enforcing NOT NULL.
ALTER TABLE "Template" ALTER COLUMN "ownerAuthId" SET NOT NULL;

ALTER TABLE "Template" ADD CONSTRAINT IF NOT EXISTS "Template_ownerAuthId_fkey"
  FOREIGN KEY ("ownerAuthId") REFERENCES "User"("authUserId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Template_ownerAuthId_idx" ON "Template"("ownerAuthId");
