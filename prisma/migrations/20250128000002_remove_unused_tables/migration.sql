-- Remove unused tables that are no longer in the Prisma schema
-- These tables were part of the old gallery system but are no longer needed

-- Drop GalleryEntry table and related constraints
DROP TABLE IF EXISTS "public"."GalleryEntry" CASCADE;

-- Drop GalleryEntryStatus enum if it exists
DROP TYPE IF EXISTS "public"."GalleryEntryStatus" CASCADE;

-- Drop Template table and related constraints  
DROP TABLE IF EXISTS "public"."Template" CASCADE;
