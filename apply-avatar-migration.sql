-- Migration: Add avatar and product fields to R2File table
-- This adds support for avatar badges and product badges on generated images
-- Run this on production database if migration hasn't been applied

-- Check if columns already exist before adding them
DO $$ 
BEGIN
    -- Add avatarId column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'R2File' 
        AND column_name = 'avatarId'
    ) THEN
        ALTER TABLE "public"."R2File" ADD COLUMN "avatarId" TEXT;
        RAISE NOTICE 'Added avatarId column';
    ELSE
        RAISE NOTICE 'avatarId column already exists';
    END IF;

    -- Add avatarImageId column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'R2File' 
        AND column_name = 'avatarImageId'
    ) THEN
        ALTER TABLE "public"."R2File" ADD COLUMN "avatarImageId" TEXT;
        RAISE NOTICE 'Added avatarImageId column';
    ELSE
        RAISE NOTICE 'avatarImageId column already exists';
    END IF;

    -- Add productId column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'R2File' 
        AND column_name = 'productId'
    ) THEN
        ALTER TABLE "public"."R2File" ADD COLUMN "productId" TEXT;
        RAISE NOTICE 'Added productId column';
    ELSE
        RAISE NOTICE 'productId column already exists';
    END IF;
END $$;

-- Verify the columns were added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'R2File'
AND column_name IN ('avatarId', 'avatarImageId', 'productId')
ORDER BY column_name;

