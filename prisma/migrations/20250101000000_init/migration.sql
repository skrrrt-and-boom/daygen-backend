-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."UsageStatus" AS ENUM ('COMPLETED', 'GRACE');

-- CreateEnum
CREATE TYPE "public"."GalleryEntryStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authUserId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "profileImage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "role" "public"."UserRole" NOT NULL DEFAULT 'USER',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerAuthId" TEXT NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GalleryEntry" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "ownerAuthId" TEXT NOT NULL,
    "templateId" TEXT,
    "assetUrl" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "public"."GalleryEntryStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "GalleryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UsageEvent" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "userAuthId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "prompt" TEXT,
    "cost" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "status" "public"."UsageStatus" NOT NULL DEFAULT 'COMPLETED',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "public"."User"("authUserId");

-- CreateIndex
CREATE INDEX "Template_ownerAuthId_idx" ON "public"."Template"("ownerAuthId");

-- CreateIndex
CREATE INDEX "GalleryEntry_ownerAuthId_createdAt_idx" ON "public"."GalleryEntry"("ownerAuthId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "UsageEvent_userAuthId_createdAt_idx" ON "public"."UsageEvent"("userAuthId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "public"."Template" ADD CONSTRAINT "Template_ownerAuthId_fkey" FOREIGN KEY ("ownerAuthId") REFERENCES "public"."User"("authUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GalleryEntry" ADD CONSTRAINT "GalleryEntry_ownerAuthId_fkey" FOREIGN KEY ("ownerAuthId") REFERENCES "public"."User"("authUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GalleryEntry" ADD CONSTRAINT "GalleryEntry_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UsageEvent" ADD CONSTRAINT "UsageEvent_userAuthId_fkey" FOREIGN KEY ("userAuthId") REFERENCES "public"."User"("authUserId") ON DELETE CASCADE ON UPDATE CASCADE;

