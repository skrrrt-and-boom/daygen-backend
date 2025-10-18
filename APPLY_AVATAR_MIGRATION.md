# Apply Avatar/Product Badge Migration to Production

## Problem

The backend code has support for avatar and product badges, but the database schema hasn't been updated in production. This causes a 500 error when trying to fetch images from `/api/r2files` and when creating new images.

## Solution

Apply the migration SQL script to add the missing columns to the R2File table.

## Option 1: Using Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy the contents of `apply-avatar-migration.sql`
4. Paste into the SQL Editor
5. Click "Run" to execute the migration
6. Verify the output shows the columns were added or already exist

## Option 2: Using Prisma Migrate Deploy (If accessible)

If you have access to run commands on your production server:

```bash
cd /path/to/daygen-backend
npx prisma migrate deploy
```

This will apply all pending migrations including `20251018194748_add_avatar_product_fields`.

## Option 3: Using psql Command Line

If you have direct database access:

```bash
psql "postgresql://[USERNAME]:[PASSWORD]@db.kxrxsydlhfkkmvwypcqm.supabase.co:5432/postgres" \
  -f apply-avatar-migration.sql
```

## Verification

After applying the migration, verify the columns exist:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'R2File'
AND column_name IN ('avatarId', 'avatarImageId', 'productId')
ORDER BY column_name;
```

Expected output:
```
   column_name   | data_type | is_nullable 
-----------------+-----------+-------------
 avatarId        | text      | YES
 avatarImageId   | text      | YES
 productId       | text      | YES
```

## After Migration

1. The backend should automatically work with the new columns
2. Test creating an image with an avatar selected
3. Verify the avatar badge appears on the generated image
4. Check that `/api/r2files` no longer returns 500 errors
5. Confirm all gallery images load correctly

## Rollback (if needed)

If you need to rollback this migration:

```sql
ALTER TABLE "public"."R2File" DROP COLUMN IF EXISTS "avatarId";
ALTER TABLE "public"."R2File" DROP COLUMN IF EXISTS "avatarImageId";
ALTER TABLE "public"."R2File" DROP COLUMN IF EXISTS "productId";
```

**Note:** Only rollback if absolutely necessary, as this will remove avatar/product data from existing records.

