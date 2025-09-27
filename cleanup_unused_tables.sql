-- Cleanup script for unused tables in Supabase
-- Run this in Supabase SQL Editor to remove unused tables

-- First, let's check what's in these tables
SELECT 'GalleryEntry' as table_name, COUNT(*) as record_count FROM "GalleryEntry"
UNION ALL
SELECT 'Template' as table_name, COUNT(*) as record_count FROM "Template";

-- If the above shows 0 records, you can safely run the cleanup below
-- Otherwise, you might want to backup the data first

-- Drop GalleryEntry table and related constraints
DROP TABLE IF EXISTS "public"."GalleryEntry" CASCADE;

-- Drop GalleryEntryStatus enum if it exists
DROP TYPE IF EXISTS "public"."GalleryEntryStatus" CASCADE;

-- Drop Template table and related constraints  
DROP TABLE IF EXISTS "public"."Template" CASCADE;

-- Verify cleanup
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('GalleryEntry', 'Template');