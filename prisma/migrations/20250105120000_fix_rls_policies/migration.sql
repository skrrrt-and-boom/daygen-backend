-- Fix RLS policies for Supabase
-- Disable RLS on tables that exist to allow backend service access

-- Only disable RLS if tables exist
DO $$
BEGIN
    -- Disable RLS on User table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'User' AND table_schema = 'public') THEN
        ALTER TABLE "User" DISABLE ROW LEVEL SECURITY;
    END IF;
    
    -- Disable RLS on UsageEvent table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'UsageEvent' AND table_schema = 'public') THEN
        ALTER TABLE "UsageEvent" DISABLE ROW LEVEL SECURITY;
    END IF;
    
    -- Disable RLS on R2File table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'R2File' AND table_schema = 'public') THEN
        ALTER TABLE "R2File" DISABLE ROW LEVEL SECURITY;
    END IF;
    
    -- Disable RLS on Job table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Job' AND table_schema = 'public') THEN
        ALTER TABLE "Job" DISABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- Grant necessary permissions to the service role (only if tables exist)
DO $$
BEGIN
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
END $$;

-- Grant sequence permissions
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
