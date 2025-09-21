-- Enable RLS on application tables
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- Drop legacy policies if they exist to avoid duplicates when reapplying
DROP POLICY IF EXISTS "user_select_own" ON public."User";
DROP POLICY IF EXISTS "user_insert_own" ON public."User";
DROP POLICY IF EXISTS "user_update_own" ON public."User";
DROP POLICY IF EXISTS "user_delete_own" ON public."User";
DROP POLICY IF EXISTS "template_select_own" ON public."Template";
DROP POLICY IF EXISTS "template_write_own" ON public."Template";
DROP POLICY IF EXISTS "template_manage_migrations" ON public."_prisma_migrations";

-- Users: authenticated callers can work with the row bound to their auth UID
CREATE POLICY "user_select_own" ON public."User"
  FOR SELECT TO authenticated
  USING ("authUserId" = (SELECT auth.uid()));

CREATE POLICY "user_insert_own" ON public."User"
  FOR INSERT TO authenticated
  WITH CHECK ("authUserId" = (SELECT auth.uid()));

CREATE POLICY "user_update_own" ON public."User"
  FOR UPDATE TO authenticated
  USING ("authUserId" = (SELECT auth.uid()))
  WITH CHECK ("authUserId" = (SELECT auth.uid()));

CREATE POLICY "user_delete_own" ON public."User"
  FOR DELETE TO authenticated
  USING ("authUserId" = (SELECT auth.uid()));

-- Templates: authenticated callers can manage templates they own
CREATE POLICY "template_select_own" ON public."Template"
  FOR SELECT TO authenticated
  USING ("ownerAuthId" = (SELECT auth.uid()));

CREATE POLICY "template_write_own" ON public."Template"
  FOR ALL TO authenticated
  USING ("ownerAuthId" = (SELECT auth.uid()))
  WITH CHECK ("ownerAuthId" = (SELECT auth.uid()));

-- Allow the service role (used by Prisma migrations) to continue operating
CREATE POLICY "template_manage_migrations" ON public."_prisma_migrations"
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
