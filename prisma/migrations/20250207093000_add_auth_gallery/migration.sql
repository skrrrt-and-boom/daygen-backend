-- Add account management fields to users
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "passwordHash" TEXT,
  ADD COLUMN IF NOT EXISTS "displayName" TEXT,
  ADD COLUMN IF NOT EXISTS "credits" INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "profileImage" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

UPDATE "User"
SET "passwordHash" = COALESCE("passwordHash", '::legacy::password::unset::'),
    "updatedAt"   = COALESCE("updatedAt", NOW());

ALTER TABLE "User"
  ALTER COLUMN "passwordHash" SET NOT NULL,
  ALTER COLUMN "credits" SET NOT NULL,
  ALTER COLUMN "updatedAt" SET NOT NULL;

-- Create gallery table for persisting generations
CREATE TABLE IF NOT EXISTS "GalleryEntry" (
  "id"          TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "ownerAuthId" TEXT         NOT NULL,
  "templateId"  TEXT,
  "assetUrl"    TEXT         NOT NULL,
  "metadata"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "GalleryEntry_ownerAuthId_createdAt_idx"
  ON "GalleryEntry" ("ownerAuthId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GalleryEntry_ownerAuthId_fkey'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE "GalleryEntry"
      ADD CONSTRAINT "GalleryEntry_ownerAuthId_fkey"
      FOREIGN KEY ("ownerAuthId") REFERENCES "User"("authUserId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GalleryEntry_templateId_fkey'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE "GalleryEntry"
      ADD CONSTRAINT "GalleryEntry_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "Template"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- Trigger to keep updatedAt in sync
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_user_updated_at ON "User";
CREATE TRIGGER set_user_updated_at
  BEFORE UPDATE ON "User"
  FOR EACH ROW
  EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS set_gallery_entry_updated_at ON "GalleryEntry";
CREATE TRIGGER set_gallery_entry_updated_at
  BEFORE UPDATE ON "GalleryEntry"
  FOR EACH ROW
  EXECUTE PROCEDURE set_updated_at();
