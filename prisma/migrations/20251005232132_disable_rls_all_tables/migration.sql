-- Disable RLS on all tables to allow backend service access
-- This migration ensures that the backend can access all tables without RLS restrictions

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

-- Disable RLS on _prisma_migrations table (if it exists and has RLS enabled)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c 
        JOIN pg_namespace n ON n.oid = c.relnamespace 
        WHERE c.relname = '_prisma_migrations' 
        AND n.nspname = 'public'
        AND c.relrowsecurity = true
    ) THEN
        ALTER TABLE "_prisma_migrations" DISABLE ROW LEVEL SECURITY;
    END IF;
END $$;
