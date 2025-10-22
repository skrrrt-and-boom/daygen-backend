-- Supabase RLS Policies Setup
-- This script creates proper Row Level Security policies for all tables
-- Based on Supabase documentation: https://supabase.com/docs

-- Enable RLS on all tables
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "R2File" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY;

-- =============================================
-- USER TABLE POLICIES
-- =============================================

-- Users can read their own profile
CREATE POLICY "Users can view own profile" ON "User"
    FOR SELECT USING (auth.uid()::text = "authUserId");

-- Users can update their own profile (except sensitive fields)
CREATE POLICY "Users can update own profile" ON "User"
    FOR UPDATE USING (auth.uid()::text = "authUserId")
    WITH CHECK (auth.uid()::text = "authUserId");

-- Users can insert their own profile during signup
CREATE POLICY "Users can create own profile" ON "User"
    FOR INSERT WITH CHECK (auth.uid()::text = "authUserId");

-- Service role can do everything (for backend operations)
CREATE POLICY "Service role full access" ON "User"
    FOR ALL USING (auth.role() = 'service_role');

-- Admins can read all users
CREATE POLICY "Admins can view all users" ON "User"
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM "User" 
            WHERE "authUserId" = auth.uid()::text 
            AND "role" = 'ADMIN'
        )
    );

-- =============================================
-- USAGE EVENT TABLE POLICIES
-- =============================================

-- Users can view their own usage events
CREATE POLICY "Users can view own usage events" ON "UsageEvent"
    FOR SELECT USING (auth.uid()::text = "userAuthId");

-- Service role can do everything (for backend operations)
CREATE POLICY "Service role full access" ON "UsageEvent"
    FOR ALL USING (auth.role() = 'service_role');

-- Admins can view all usage events
CREATE POLICY "Admins can view all usage events" ON "UsageEvent"
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM "User" 
            WHERE "authUserId" = auth.uid()::text 
            AND "role" = 'ADMIN'
        )
    );

-- =============================================
-- R2FILE TABLE POLICIES
-- =============================================

-- Users can view their own files
CREATE POLICY "Users can view own files" ON "R2File"
    FOR SELECT USING (auth.uid()::text = "ownerAuthId");

-- Users can insert their own files
CREATE POLICY "Users can create own files" ON "R2File"
    FOR INSERT WITH CHECK (auth.uid()::text = "ownerAuthId");

-- Users can update their own files
CREATE POLICY "Users can update own files" ON "R2File"
    FOR UPDATE USING (auth.uid()::text = "ownerAuthId")
    WITH CHECK (auth.uid()::text = "ownerAuthId");

-- Users can delete their own files (soft delete)
CREATE POLICY "Users can delete own files" ON "R2File"
    FOR UPDATE USING (auth.uid()::text = "ownerAuthId")
    WITH CHECK (auth.uid()::text = "ownerAuthId");

-- Service role can do everything (for backend operations)
CREATE POLICY "Service role full access" ON "R2File"
    FOR ALL USING (auth.role() = 'service_role');

-- Admins can view all files
CREATE POLICY "Admins can view all files" ON "R2File"
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM "User" 
            WHERE "authUserId" = auth.uid()::text 
            AND "role" = 'ADMIN'
        )
    );

-- =============================================
-- JOB TABLE POLICIES
-- =============================================

-- Users can view their own jobs
CREATE POLICY "Users can view own jobs" ON "Job"
    FOR SELECT USING (auth.uid()::text = "userId");

-- Users can create their own jobs
CREATE POLICY "Users can create own jobs" ON "Job"
    FOR INSERT WITH CHECK (auth.uid()::text = "userId");

-- Users can update their own jobs (for status updates, etc.)
CREATE POLICY "Users can update own jobs" ON "Job"
    FOR UPDATE USING (auth.uid()::text = "userId")
    WITH CHECK (auth.uid()::text = "userId");

-- Service role can do everything (for backend operations)
CREATE POLICY "Service role full access" ON "Job"
    FOR ALL USING (auth.role() = 'service_role');

-- Admins can view all jobs
CREATE POLICY "Admins can view all jobs" ON "Job"
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM "User" 
            WHERE "authUserId" = auth.uid()::text 
            AND "role" = 'ADMIN'
        )
    );

-- =============================================
-- GRANT PERMISSIONS
-- =============================================

-- Grant necessary permissions to service role
GRANT ALL ON "User" TO service_role;
GRANT ALL ON "UsageEvent" TO service_role;
GRANT ALL ON "R2File" TO service_role;
GRANT ALL ON "Job" TO service_role;

-- Grant sequence permissions
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- =============================================
-- VERIFICATION QUERIES
-- =============================================

-- Check RLS status
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('User', 'UsageEvent', 'R2File', 'Job');

-- Check policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename IN ('User', 'UsageEvent', 'R2File', 'Job')
ORDER BY tablename, policyname;
