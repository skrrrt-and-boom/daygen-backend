-- Enable RLS on the _prisma_migrations table
ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- Policy for _prisma_migrations (read-only for authenticated users)
CREATE POLICY "Allow read access to _prisma_migrations" ON "public"."_prisma_migrations"
FOR SELECT USING (true);
