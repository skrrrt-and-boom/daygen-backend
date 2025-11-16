-- =============================================================================
-- COPY AND PASTE THIS ENTIRE FILE INTO SUPABASE SQL EDITOR
-- =============================================================================
-- This migration adds avatar and product badge support to the R2File table
-- It's safe to run multiple times (idempotent)
-- =============================================================================

-- Add the three columns if they don't exist
DO $$ 
BEGIN
    -- Add avatarId column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'R2File' 
        AND column_name = 'avatarId'
    ) THEN
        ALTER TABLE "public"."R2File" ADD COLUMN "avatarId" TEXT;
        RAISE NOTICE 'SUCCESS: Added avatarId column';
    ELSE
        RAISE NOTICE 'INFO: avatarId column already exists (migration already applied)';
    END IF;

    -- Add avatarImageId column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'R2File' 
        AND column_name = 'avatarImageId'
    ) THEN
        ALTER TABLE "public"."R2File" ADD COLUMN "avatarImageId" TEXT;
        RAISE NOTICE 'SUCCESS: Added avatarImageId column';
    ELSE
        RAISE NOTICE 'INFO: avatarImageId column already exists (migration already applied)';
    END IF;

    -- Add productId column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'R2File' 
        AND column_name = 'productId'
    ) THEN
        ALTER TABLE "public"."R2File" ADD COLUMN "productId" TEXT;
        RAISE NOTICE 'SUCCESS: Added productId column';
    ELSE
        RAISE NOTICE 'INFO: productId column already exists (migration already applied)';
    END IF;
END $$;

-- Verify the columns were added successfully
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    '✅ Column exists' as status
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'R2File'
AND column_name IN ('avatarId', 'avatarImageId', 'productId')
ORDER BY column_name;

-- =============================================================================
-- EXPECTED OUTPUT:
-- =============================================================================
-- You should see 3 rows with:
--   avatarId      | text | YES | ✅ Column exists
--   avatarImageId | text | YES | ✅ Column exists
--   productId     | text | YES | ✅ Column exists
--
-- If you see these 3 rows, the migration was successful!
-- =============================================================================

