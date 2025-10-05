-- Disable RLS on all tables to allow backend service access
-- This migration ensures that the backend can access all tables without RLS restrictions

-- Disable RLS on User table
ALTER TABLE "User" DISABLE ROW LEVEL SECURITY;

-- Disable RLS on UsageEvent table  
ALTER TABLE "UsageEvent" DISABLE ROW LEVEL SECURITY;

-- Disable RLS on R2File table
ALTER TABLE "R2File" DISABLE ROW LEVEL SECURITY;

-- Disable RLS on Job table
ALTER TABLE "Job" DISABLE ROW LEVEL SECURITY;

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
