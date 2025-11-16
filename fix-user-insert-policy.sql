-- =============================================================================
-- FIX: Add missing User INSERT policy for Google OAuth signup
-- =============================================================================
-- This script fixes the "Database error granting user" error during OAuth signup
-- by adding an INSERT policy that allows users to create their own profile
-- =============================================================================
-- SAFE TO RUN MULTIPLE TIMES (idempotent)
-- =============================================================================

-- Drop the policy if it already exists (to make this script idempotent)
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Users can create own profile" ON "User";
    RAISE NOTICE 'Dropped existing policy (if any)';
EXCEPTION 
    WHEN undefined_object THEN
        RAISE NOTICE 'Policy does not exist yet, will create it';
END $$;

-- Create the INSERT policy for User table
CREATE POLICY "Users can create own profile" ON "User"
    FOR INSERT WITH CHECK (auth.uid()::text = "authUserId");

-- Verify the policy was created
DO $$
DECLARE
    policy_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'User'
    AND policyname = 'Users can create own profile';
    
    IF policy_count > 0 THEN
        RAISE NOTICE '✅ SUCCESS: INSERT policy created for User table';
    ELSE
        RAISE EXCEPTION '❌ FAILED: Policy was not created';
    END IF;
END $$;

-- =============================================================================
-- EXPECTED OUTPUT:
-- =============================================================================
-- You should see:
--   NOTICE: Dropped existing policy (if any)
--   NOTICE: ✅ SUCCESS: INSERT policy created for User table
--
-- Now users can sign up via Google OAuth without database errors!
-- =============================================================================

-- Show all current User table policies
SELECT 
    schemaname,
    tablename,
    policyname,
    '✅' as status
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'User'
ORDER BY policyname;

