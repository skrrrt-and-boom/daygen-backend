-- Drop GalleryEntry table and related constraints
DROP TABLE IF EXISTS "public"."GalleryEntry" CASCADE;

-- Drop GalleryEntryStatus enum
DROP TYPE IF EXISTS "public"."GalleryEntryStatus" CASCADE;

-- Update User model to remove GalleryEntry relation
-- (This is handled by Prisma schema changes)

-- Update Template model to remove GalleryEntry relation  
-- (This is handled by Prisma schema changes)
