-- Fix RLS policies for Supabase
-- This script disables RLS on tables that need to be accessible by the backend service

-- Disable RLS on all tables to allow backend service access
ALTER TABLE "User" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageEvent" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "R2File" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Job" DISABLE ROW LEVEL SECURITY;

-- Alternative: If you want to keep RLS enabled, create policies instead:
-- Enable RLS but create policies for service access
-- ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE "UsageEvent" ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE "R2File" ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY;

-- Create policies for service access (uncomment if you want to keep RLS enabled)
-- CREATE POLICY "Allow all operations for service role" ON "User" FOR ALL USING (true);
-- CREATE POLICY "Allow all operations for service role" ON "UsageEvent" FOR ALL USING (true);
-- CREATE POLICY "Allow all operations for service role" ON "R2File" FOR ALL USING (true);
-- CREATE POLICY "Allow all operations for service role" ON "Job" FOR ALL USING (true);

-- Grant necessary permissions to the service role
GRANT ALL ON "User" TO service_role;
GRANT ALL ON "UsageEvent" TO service_role;
GRANT ALL ON "R2File" TO service_role;
GRANT ALL ON "Job" TO service_role;

-- Grant sequence permissions
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
