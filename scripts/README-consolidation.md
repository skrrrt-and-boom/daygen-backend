# R2 Image Consolidation Scripts

This directory contains scripts to consolidate all R2 images from `migrated-external/` and `migrated-images/` directories into `generated-images/`, and ensure all database URLs are proper R2 public URLs.

## Scripts Overview

### 1. `verify-r2-consolidation.js`
**Purpose**: Check the current state of R2 bucket and database URLs
**Usage**: Run this first to see what needs to be consolidated

```bash
cd /Users/dominiknowak/code/daygen-backend
node scripts/verify-r2-consolidation.js
```

### 2. `update-db-urls-to-r2.js`
**Purpose**: Find and update all non-R2 URLs in database to R2 public URLs
**Usage**: Run this to migrate base64 and external URLs to R2

```bash
cd /Users/dominiknowak/code/daygen-backend
node scripts/update-db-urls-to-r2.js
```

### 3. `consolidate-r2-images.js`
**Purpose**: Move all files from old directories to `generated-images/` and update database
**Usage**: Run this to consolidate the R2 bucket structure

```bash
cd /Users/dominiknowak/code/daygen-backend
node scripts/consolidate-r2-images.js
```

## Execution Order

1. **Pre-check**: Run verification script to see current state
   ```bash
   node scripts/verify-r2-consolidation.js
   ```

2. **Database Migration**: Update all database URLs to R2 URLs
   ```bash
   node scripts/update-db-urls-to-r2.js
   ```

3. **R2 Consolidation**: Move files and update database paths
   ```bash
   node scripts/consolidate-r2-images.js
   ```

4. **Post-check**: Verify everything is consolidated
   ```bash
   node scripts/verify-r2-consolidation.js
   ```

## What Each Script Does

### verify-r2-consolidation.js
- Lists all objects in R2 bucket by prefix
- Checks for objects in `migrated-external/` and `migrated-images/` (should be 0 after consolidation)
- Verifies all `R2File.fileUrl` values are R2 public URLs
- Verifies all `Job.resultUrl` values are R2 public URLs (or null)
- Reports any issues that need attention

### update-db-urls-to-r2.js
- Finds all `R2File` records with non-R2 URLs (base64, external, etc.)
- Finds all `Job` records with non-R2 URLs in `resultUrl`
- For each record:
  - Downloads base64/external content
  - Uploads to R2 with `generated-images/` prefix
  - Updates database with new R2 public URL
- Reports statistics and any errors

### consolidate-r2-images.js
- Lists all objects in `migrated-external/` and `migrated-images/`
- For each object:
  - Copies to `generated-images/` with new UUID filename
  - Updates all `R2File` records pointing to old URL
  - Updates all `Job` records pointing to old URL
- Optionally deletes old objects (with user confirmation)
- Reports statistics and any errors

## Safety Features

- All scripts use transactions where possible
- Detailed logging of all operations
- Error handling with rollback capability
- User confirmation before deleting old objects
- Validation to prevent base64 URLs in database

## Backend Changes

The following backend changes have been made:

1. **R2Service** (`src/upload/r2.service.ts`):
   - Default folder changed from `images` to `generated-images`
   - Added `validateR2Url()` method
   - Added `isBase64Url()` method

2. **R2FilesService** (`src/r2files/r2files.service.ts`):
   - Added validation to reject base64 URLs
   - Added validation to ensure only R2 URLs are stored

3. **CloudTasksService** (`src/jobs/cloud-tasks.service.ts`):
   - Added validation to reject base64 URLs in job results

## Expected Results

After running all scripts:

- ✅ R2 bucket only contains `generated-images/`, `profile-pictures/`, etc.
- ✅ No objects in `migrated-external/` or `migrated-images/`
- ✅ All `R2File.fileUrl` values are R2 public URLs
- ✅ All `Job.resultUrl` values are R2 public URLs (or null)
- ✅ Backend validates against base64 URLs

## Troubleshooting

If you encounter issues:

1. Check R2 environment variables are set correctly
2. Ensure R2 bucket has public access enabled
3. Check database connection
4. Review error logs for specific failures
5. Run verification script to see current state

## Rollback

If you need to rollback:
- Old R2 objects are kept until you confirm deletion
- Database changes can be reverted by running the migration scripts in reverse
- Backend validation can be disabled by removing the validation checks
