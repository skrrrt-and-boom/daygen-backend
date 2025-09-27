-- Create R2File table if it doesn't exist
CREATE TABLE IF NOT EXISTS "R2File" (
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

-- Create index if it doesn't exist
CREATE INDEX IF NOT EXISTS "R2File_ownerAuthId_createdAt_idx" ON "R2File"("ownerAuthId", "createdAt" DESC);
