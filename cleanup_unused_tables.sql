-- Clean up unused tables that are no longer in the Prisma schema
-- This script should be run manually on the Supabase database

-- Drop GalleryEntry table and related constraints
DROP TABLE IF EXISTS "public"."GalleryEntry" CASCADE;

-- Drop GalleryEntryStatus enum if it exists
DROP TYPE IF EXISTS "public"."GalleryEntryStatus" CASCADE;

-- Drop Template table and related constraints
DROP TABLE IF EXISTS "public"."Template" CASCADE;

-- Note: These tables should have been removed by previous migrations
-- but may still exist in the production database
