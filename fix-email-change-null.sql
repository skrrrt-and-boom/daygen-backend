-- Fix NULL email_change values in auth.users table
-- This resolves the "converting NULL to string is unsupported" error during Google OAuth
-- 
-- Run this in your Supabase SQL Editor:
-- 1. Go to your Supabase dashboard
-- 2. Navigate to SQL Editor
-- 3. Paste and run this script

UPDATE auth.users 
SET email_change = '' 
WHERE email_change IS NULL;

-- Verify the fix
SELECT id, email, email_change 
FROM auth.users 
WHERE email_change IS NULL;

-- If the SELECT returns no rows, the issue is fixed



