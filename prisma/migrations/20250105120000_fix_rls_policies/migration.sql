-- Fix RLS policies for Supabase
-- Disable RLS on all tables to allow backend service access

ALTER TABLE "User" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageEvent" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "R2File" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Job" DISABLE ROW LEVEL SECURITY;

-- Grant necessary permissions to the service role
GRANT ALL ON "User" TO service_role;
GRANT ALL ON "UsageEvent" TO service_role;
GRANT ALL ON "R2File" TO service_role;
GRANT ALL ON "Job" TO service_role;

-- Grant sequence permissions
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
