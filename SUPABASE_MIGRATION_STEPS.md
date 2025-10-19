# Run Database Migration in Supabase - Step by Step

## ⚠️ IMPORTANT
Your local machine cannot connect to the Supabase database, so you need to run the migration through the Supabase dashboard.

## 📋 Steps to Apply Migration

### Step 1: Open Supabase Dashboard
1. Go to https://supabase.com/dashboard
2. Sign in with your account
3. Select your project (the one with database: `db.kxrxsydlhfkkmvwypcqm.supabase.co`)

### Step 2: Open SQL Editor
1. In the left sidebar, click on **"SQL Editor"**
2. Click **"New query"** button (top right)

### Step 3: Copy and Paste the Migration SQL
1. Open the file: `/Users/jakubst/Desktop/daygen-backend/RUN_THIS_IN_SUPABASE.sql`
2. Select ALL the contents (Cmd+A)
3. Copy (Cmd+C)
4. Paste into the Supabase SQL Editor (Cmd+V)

### Step 4: Run the Migration
1. Click the **"Run"** button (or press Cmd+Enter)
2. Wait for it to complete (should take 1-2 seconds)

### Step 5: Verify Success
You should see output similar to:

```
NOTICE:  SUCCESS: Added avatarId column
NOTICE:  SUCCESS: Added avatarImageId column  
NOTICE:  SUCCESS: Added productId column

Results:
┌───────────────┬───────────┬─────────────┬──────────────────┐
│ column_name   │ data_type │ is_nullable │ status           │
├───────────────┼───────────┼─────────────┼──────────────────┤
│ avatarId      │ text      │ YES         │ ✅ Column exists │
│ avatarImageId │ text      │ YES         │ ✅ Column exists │
│ productId     │ text      │ YES         │ ✅ Column exists │
└───────────────┴───────────┴─────────────┴──────────────────┘
```

### Step 6: Mark Migration as Applied in Prisma
After successfully running the SQL, you need to tell Prisma that the migration was applied:

```bash
cd /Users/jakubst/Desktop/daygen-backend
npx prisma migrate resolve --applied 20251018194748_add_avatar_product_fields
```

**Note:** This step might fail if Prisma can't connect to the database from your local machine. That's okay - the important part is that the SQL was run in Step 4.

## ✅ What This Fixes

After applying this migration:
- ✅ The 500 error on `/api/r2files` will be fixed
- ✅ Gallery images will load correctly
- ✅ New images can be created with avatar and product data
- ✅ Avatar and product badges will persist in the database

## 🔍 Troubleshooting

### If you see "column already exists" messages
That's fine! It means the migration was already applied. The script is idempotent (safe to run multiple times).

### If you see an error about permissions
Make sure you're logged into the correct Supabase account and have selected the right project.

### If the SQL Editor doesn't load
Try refreshing the page or opening an incognito window.

## 📞 Next Steps After Migration

1. Hard refresh your application (Cmd+Shift+R)
2. Try generating an image with an avatar selected
3. Check the browser console for the debug log: `[DEBUG] Avatar state before generation:`
4. Report back whether:
   - The 500 error is gone ✅
   - Gallery images load ✅
   - Avatar data is still undefined or now works ✅

## 🆘 If You Need Help

If you encounter any issues:
1. Take a screenshot of the error
2. Share the exact error message
3. Check the Supabase dashboard logs (Logs section in left sidebar)

