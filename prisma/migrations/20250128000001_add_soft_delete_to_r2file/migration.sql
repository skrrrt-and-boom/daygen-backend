-- Add soft delete support to R2File table
ALTER TABLE "R2File" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Create index for soft delete queries
CREATE INDEX "R2File_ownerAuthId_deletedAt_idx" ON "R2File"("ownerAuthId", "deletedAt");
