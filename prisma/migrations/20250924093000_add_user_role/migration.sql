-- Create UserRole enum if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'UserRole'
  ) THEN
    CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
  END IF;
END
$$;

-- Add role column defaulting to USER
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'USER';

-- Ensure existing rows have a role assigned
UPDATE "User"
SET "role" = 'USER'
WHERE "role" IS NULL;

-- Maintain default for future inserts
ALTER TABLE "User"
  ALTER COLUMN "role" SET DEFAULT 'USER';
