-- Add GalleryEntryStatus enum and soft-delete column
CREATE TYPE "GalleryEntryStatus" AS ENUM ('ACTIVE', 'REMOVED');

ALTER TABLE "GalleryEntry"
  ADD COLUMN "status" "GalleryEntryStatus" NOT NULL DEFAULT 'ACTIVE';
