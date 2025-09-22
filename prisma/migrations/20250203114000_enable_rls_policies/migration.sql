-- Enable RLS on application tables
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Template" ENABLE ROW LEVEL SECURITY;

-- Drop legacy policies if they exist to avoid duplicates when reapplying
DROP POLICY IF EXISTS "user_select_own" ON "User";
DROP POLICY IF EXISTS "user_insert_own" ON "User";
DROP POLICY IF EXISTS "user_update_own" ON "User";
DROP POLICY IF EXISTS "user_delete_own" ON "User";
DROP POLICY IF EXISTS "template_select_own" ON "Template";
DROP POLICY IF EXISTS "template_write_own" ON "Template";

DO $$
BEGIN
  -- Supabase exposes auth.uid() via the auth schema. Skip policy creation when
  -- the schema is missing (e.g. newly created shadow databases during migrate dev).
  IF EXISTS (
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth'
  ) THEN
    -- Users: authenticated callers can work with the row bound to their auth UID
    CREATE POLICY "user_select_own" ON "User"
      FOR SELECT TO authenticated
      USING ("authUserId" = (SELECT auth.uid())::text);

    CREATE POLICY "user_insert_own" ON "User"
      FOR INSERT TO authenticated
      WITH CHECK ("authUserId" = (SELECT auth.uid())::text);

    CREATE POLICY "user_update_own" ON "User"
      FOR UPDATE TO authenticated
      USING ("authUserId" = (SELECT auth.uid())::text)
      WITH CHECK ("authUserId" = (SELECT auth.uid())::text);

    CREATE POLICY "user_delete_own" ON "User"
      FOR DELETE TO authenticated
      USING ("authUserId" = (SELECT auth.uid())::text);

    -- Templates: authenticated callers can manage templates they own
    CREATE POLICY "template_select_own" ON "Template"
      FOR SELECT TO authenticated
      USING ("ownerAuthId" = (SELECT auth.uid())::text);

    CREATE POLICY "template_write_own" ON "Template"
      FOR ALL TO authenticated
      USING ("ownerAuthId" = (SELECT auth.uid())::text)
      WITH CHECK ("ownerAuthId" = (SELECT auth.uid())::text);

  ELSE
    RAISE NOTICE 'auth schema missing, skipping Supabase auth policies';
  END IF;
END
$$ LANGUAGE plpgsql;
