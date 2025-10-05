-- Supabase RLS Policies Setup
-- This migration creates proper Row Level Security policies for all tables
-- Based on Supabase documentation: https://supabase.com/docs

-- Enable RLS on all tables (only if they exist)
DO $$
BEGIN
    -- Enable RLS on User table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'User' AND table_schema = 'public') THEN
        ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
    END IF;
    
    -- Enable RLS on UsageEvent table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'UsageEvent' AND table_schema = 'public') THEN
        ALTER TABLE "UsageEvent" ENABLE ROW LEVEL SECURITY;
    END IF;
    
    -- Enable RLS on R2File table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'R2File' AND table_schema = 'public') THEN
        ALTER TABLE "R2File" ENABLE ROW LEVEL SECURITY;
    END IF;
    
    -- Enable RLS on Job table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Job' AND table_schema = 'public') THEN
        ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY;
    END IF;
    
    -- Enable RLS on _prisma_migrations table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_prisma_migrations' AND table_schema = 'public') THEN
        ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- =============================================
-- USER TABLE POLICIES
-- =============================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'User' AND table_schema = 'public') THEN
        -- Drop existing policies if they exist
        DROP POLICY IF EXISTS "Users can view own profile" ON "User";
        DROP POLICY IF EXISTS "Users can update own profile" ON "User";
        DROP POLICY IF EXISTS "Service role full access" ON "User";
        DROP POLICY IF EXISTS "Admins can view all users" ON "User";
        
        -- Create new policies
        CREATE POLICY "Users can view own profile" ON "User"
            FOR SELECT USING (auth.uid()::text = "authUserId");
        
        CREATE POLICY "Users can update own profile" ON "User"
            FOR UPDATE USING (auth.uid()::text = "authUserId")
            WITH CHECK (auth.uid()::text = "authUserId");
        
        CREATE POLICY "Service role full access" ON "User"
            FOR ALL USING (auth.role() = 'service_role');
        
        CREATE POLICY "Admins can view all users" ON "User"
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM "User" 
                    WHERE "authUserId" = auth.uid()::text 
                    AND "role" = 'ADMIN'
                )
            );
    END IF;
END $$;

-- =============================================
-- USAGE EVENT TABLE POLICIES
-- =============================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'UsageEvent' AND table_schema = 'public') THEN
        -- Drop existing policies if they exist
        DROP POLICY IF EXISTS "Users can view own usage events" ON "UsageEvent";
        DROP POLICY IF EXISTS "Service role full access" ON "UsageEvent";
        DROP POLICY IF EXISTS "Admins can view all usage events" ON "UsageEvent";
        
        -- Create new policies
        CREATE POLICY "Users can view own usage events" ON "UsageEvent"
            FOR SELECT USING (auth.uid()::text = "userAuthId");
        
        CREATE POLICY "Service role full access" ON "UsageEvent"
            FOR ALL USING (auth.role() = 'service_role');
        
        CREATE POLICY "Admins can view all usage events" ON "UsageEvent"
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM "User" 
                    WHERE "authUserId" = auth.uid()::text 
                    AND "role" = 'ADMIN'
                )
            );
    END IF;
END $$;

-- =============================================
-- R2FILE TABLE POLICIES
-- =============================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'R2File' AND table_schema = 'public') THEN
        -- Drop existing policies if they exist
        DROP POLICY IF EXISTS "Users can view own files" ON "R2File";
        DROP POLICY IF EXISTS "Users can create own files" ON "R2File";
        DROP POLICY IF EXISTS "Users can update own files" ON "R2File";
        DROP POLICY IF EXISTS "Users can delete own files" ON "R2File";
        DROP POLICY IF EXISTS "Service role full access" ON "R2File";
        DROP POLICY IF EXISTS "Admins can view all files" ON "R2File";
        
        -- Create new policies
        CREATE POLICY "Users can view own files" ON "R2File"
            FOR SELECT USING (auth.uid()::text = "ownerAuthId");
        
        CREATE POLICY "Users can create own files" ON "R2File"
            FOR INSERT WITH CHECK (auth.uid()::text = "ownerAuthId");
        
        CREATE POLICY "Users can update own files" ON "R2File"
            FOR UPDATE USING (auth.uid()::text = "ownerAuthId")
            WITH CHECK (auth.uid()::text = "ownerAuthId");
        
        CREATE POLICY "Users can delete own files" ON "R2File"
            FOR UPDATE USING (auth.uid()::text = "ownerAuthId")
            WITH CHECK (auth.uid()::text = "ownerAuthId");
        
        CREATE POLICY "Service role full access" ON "R2File"
            FOR ALL USING (auth.role() = 'service_role');
        
        CREATE POLICY "Admins can view all files" ON "R2File"
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM "User" 
                    WHERE "authUserId" = auth.uid()::text 
                    AND "role" = 'ADMIN'
                )
            );
    END IF;
END $$;

-- =============================================
-- JOB TABLE POLICIES
-- =============================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Job' AND table_schema = 'public') THEN
        -- Drop existing policies if they exist
        DROP POLICY IF EXISTS "Users can view own jobs" ON "Job";
        DROP POLICY IF EXISTS "Users can create own jobs" ON "Job";
        DROP POLICY IF EXISTS "Users can update own jobs" ON "Job";
        DROP POLICY IF EXISTS "Service role full access" ON "Job";
        DROP POLICY IF EXISTS "Admins can view all jobs" ON "Job";
        
        -- Create new policies
        CREATE POLICY "Users can view own jobs" ON "Job"
            FOR SELECT USING (auth.uid()::text = "userId");
        
        CREATE POLICY "Users can create own jobs" ON "Job"
            FOR INSERT WITH CHECK (auth.uid()::text = "userId");
        
        CREATE POLICY "Users can update own jobs" ON "Job"
            FOR UPDATE USING (auth.uid()::text = "userId")
            WITH CHECK (auth.uid()::text = "userId");
        
        CREATE POLICY "Service role full access" ON "Job"
            FOR ALL USING (auth.role() = 'service_role');
        
        CREATE POLICY "Admins can view all jobs" ON "Job"
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM "User" 
                    WHERE "authUserId" = auth.uid()::text 
                    AND "role" = 'ADMIN'
                )
            );
    END IF;
END $$;

-- =============================================
-- _PRISMA_MIGRATIONS TABLE POLICIES
-- =============================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_prisma_migrations' AND table_schema = 'public') THEN
        -- Drop existing policies if they exist
        DROP POLICY IF EXISTS "Service role full access" ON "_prisma_migrations";
        
        -- Create policy for service role access only
        CREATE POLICY "Service role full access" ON "_prisma_migrations"
            FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;

-- =============================================
-- GRANT PERMISSIONS
-- =============================================

-- Grant necessary permissions to service role (only if tables exist)
DO $$
BEGIN
    -- Only grant permissions if service_role exists
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        -- Grant permissions on User table if it exists
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'User' AND table_schema = 'public') THEN
            GRANT ALL ON "User" TO service_role;
        END IF;
        
        -- Grant permissions on UsageEvent table if it exists
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'UsageEvent' AND table_schema = 'public') THEN
            GRANT ALL ON "UsageEvent" TO service_role;
        END IF;
        
        -- Grant permissions on R2File table if it exists
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'R2File' AND table_schema = 'public') THEN
            GRANT ALL ON "R2File" TO service_role;
        END IF;
        
        -- Grant permissions on Job table if it exists
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Job' AND table_schema = 'public') THEN
            GRANT ALL ON "Job" TO service_role;
        END IF;
        
        -- Grant permissions on _prisma_migrations table if it exists
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_prisma_migrations' AND table_schema = 'public') THEN
            GRANT ALL ON "_prisma_migrations" TO service_role;
        END IF;
        
        -- Grant sequence permissions
        GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
    END IF;
END $$;
