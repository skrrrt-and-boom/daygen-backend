ALTER TABLE "GalleryEntry" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gallery_select_own" ON "GalleryEntry";
DROP POLICY IF EXISTS "gallery_write_own" ON "GalleryEntry";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = current_schema()
        AND tablename = 'GalleryEntry'
        AND policyname = 'gallery_select_own'
    ) THEN
      CREATE POLICY "gallery_select_own" ON "GalleryEntry"
        FOR SELECT TO authenticated
        USING ("ownerAuthId" = (SELECT auth.uid())::text);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = current_schema()
        AND tablename = 'GalleryEntry'
        AND policyname = 'gallery_write_own'
    ) THEN
      CREATE POLICY "gallery_write_own" ON "GalleryEntry"
        FOR ALL TO authenticated
        USING ("ownerAuthId" = (SELECT auth.uid())::text)
        WITH CHECK ("ownerAuthId" = (SELECT auth.uid())::text);
    END IF;
  ELSE
    RAISE NOTICE 'auth schema missing, skipping GalleryEntry policies';
  END IF;
END
$$ LANGUAGE plpgsql;
