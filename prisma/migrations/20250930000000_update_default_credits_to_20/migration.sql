-- Update existing users with 3 or fewer credits to have 20 credits
UPDATE "User" SET credits = 20 WHERE credits <= 3;

-- Update the default value for the credits column to 20
-- Note: The schema change (default(20)) is already applied in schema.prisma
-- This migration ensures the database default is updated and existing users are upgraded
ALTER TABLE "User" ALTER COLUMN "credits" SET DEFAULT 20;

