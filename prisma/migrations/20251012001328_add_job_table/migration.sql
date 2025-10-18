-- CreateEnum (only if not exists)
DO $$ BEGIN
    CREATE TYPE "public"."JobType" AS ENUM ('IMAGE_GENERATION', 'VIDEO_GENERATION', 'IMAGE_UPSCALE', 'BATCH_GENERATION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum (only if not exists)
DO $$ BEGIN
    CREATE TYPE "public"."JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable (only if not exists)
CREATE TABLE IF NOT EXISTS "public"."Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."JobType" NOT NULL,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "resultUrl" TEXT,
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (only if not exists)
CREATE INDEX IF NOT EXISTS "Job_userId_status_idx" ON "public"."Job"("userId", "status");

-- CreateIndex (only if not exists)
CREATE INDEX IF NOT EXISTS "Job_status_createdAt_idx" ON "public"."Job"("status", "createdAt");

-- AddForeignKey (only if not exists)
DO $$ BEGIN
    ALTER TABLE "public"."Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("authUserId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
