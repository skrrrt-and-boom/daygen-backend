# Google OAuth Authentication Fix - Instructions

## Problem Summary
Google OAuth sign-in was failing with the error:
```
sql: Scan error on column index 8, name "email_change": converting NULL to string is unsupported
```

This occurred because certain Supabase `auth.users` records had NULL values in the `email_change` column, which caused the Go library to fail when scanning the data.

## Solution Implemented

### 1. Backend Error Handling (Completed ✅)
Added graceful error handling in `api/src/supabase/supabase.service.ts`:
- Catches the specific "email_change" NULL error
- Falls back to extracting user info directly from the JWT token
- Allows authentication to succeed even when Supabase's `getUserById()` fails

This means affected users can now authenticate even before running the SQL fix.

### 2. Database Fix (Manual Step Required)

#### Step 1: Run the SQL Script in Supabase

1. **Go to your Supabase Dashboard**
   - Navigate to: https://supabase.com/dashboard
   - Select your project

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar

3. **Run the Fix Script**
   - Copy the contents of `api/fix-email-change-null.sql`
   - Paste into the SQL Editor
   - Click "Run" to execute

   The script will:
   - Update all NULL `email_change` values to empty strings
   - Run a verification query to confirm the fix

4. **Verify the Fix**
   - The query should show 0 rows with NULL `email_change` values
   - If you see rows, run the UPDATE statement again

#### Step 2: Deploy Backend Changes

1. **Deploy to Production**
   ```bash
   cd api
   # Make sure your backend is deployed with the updated supabase.service.ts
   # Your deployment process here (e.g., Docker, Cloud Run, etc.)
   ```

2. **Verify Backend is Running**
   - Check that the backend service restarted successfully
   - Monitor logs for any errors

#### Step 3: Test the Fix

1. **Clear Browser State** (recommended)
   ```
   - Clear cookies for daygen.ai
   - Clear local storage
   - Or use an incognito/private window
   ```

2. **Test Google Sign-In**
   - Go to https://daygen.ai
   - Click "Sign in with Google"
   - Complete the OAuth flow
   - You should be successfully signed in and redirected to the app

3. **Verify in Backend Logs**
   - If the SQL fix hasn't been run yet, you should see:
     ```
     Supabase getUserById failed due to email_change NULL issue. Falling back to JWT token extraction.
     ```
   - After running the SQL fix, this warning should not appear

## Expected Behavior

### Before SQL Fix + After Backend Deploy
- ✅ Google OAuth sign-in works (using JWT token fallback)
- ⚠️  Warning logged: "Falling back to JWT token extraction"
- ✅ User can access the app normally

### After SQL Fix
- ✅ Google OAuth sign-in works (using normal flow)
- ✅ No warnings in logs
- ✅ All database columns properly populated

## Troubleshooting

### Issue: Still getting authentication error
**Solution:**
1. Check backend logs for specific error messages
2. Verify the SQL script was run successfully
3. Ensure backend was deployed with the updated code
4. Clear browser cache/cookies and try again

### Issue: "Falling back to JWT token extraction" still appears
**Solution:**
- This is just a warning and authentication should still work
- Run the SQL fix in Supabase to permanently resolve it
- After running SQL fix, the warning will stop appearing

### Issue: Different authentication error
**Solution:**
- Check if your Supabase environment variables are correct:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Verify your Google OAuth credentials are properly configured in Supabase

## Files Modified

1. **Backend Code:**
   - `api/src/supabase/supabase.service.ts` - Added error handling and JWT fallback

2. **Database Scripts:**
   - `api/fix-email-change-null.sql` - SQL fix for NULL values

3. **Documentation:**
   - This file (`api/FIX_GOOGLE_AUTH_INSTRUCTIONS.md`)

## Notes

- The backend error handling is **permanent** and will protect against similar issues in the future
- The SQL fix is a **one-time** operation to clean up existing data
- Both changes are **backward compatible** and won't affect users without this issue



