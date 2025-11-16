-- Drop foreign key constraints first
ALTER TABLE "public"."GalleryEntry" DROP CONSTRAINT IF EXISTS "GalleryEntry_templateId_fkey";
ALTER TABLE "public"."GalleryEntry" DROP CONSTRAINT IF EXISTS "GalleryEntry_ownerAuthId_fkey";

-- Drop the GalleryEntry table
DROP TABLE IF EXISTS "public"."GalleryEntry";

-- Drop the GalleryEntryStatus enum
DROP TYPE IF EXISTS "public"."GalleryEntryStatus";

-- Create the new R2File table
CREATE TABLE "public"."R2File" (
    "id" TEXT NOT NULL,
    "ownerAuthId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "prompt" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "R2File_pkey" PRIMARY KEY ("id")
);

-- Create index for R2File
CREATE INDEX "R2File_ownerAuthId_createdAt_idx" ON "public"."R2File"("ownerAuthId", "createdAt" DESC);

-- Add foreign key constraint
ALTER TABLE "public"."R2File" ADD CONSTRAINT "R2File_ownerAuthId_fkey" FOREIGN KEY ("ownerAuthId") REFERENCES "public"."User"("authUserId") ON DELETE CASCADE ON UPDATE CASCADE;
