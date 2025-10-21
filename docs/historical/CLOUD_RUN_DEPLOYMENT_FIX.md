# Cloud Run Deployment Fix

## Issues Fixed

### 1. Prettier Formatting Errors ✅
- **File**: `src/main.ts`
- **Lines**: 73, 77, 79
- **Issue**: Extra spaces and incorrect line formatting
- **Fix**: Reformatted console.log statements to satisfy prettier rules

### 2. Cloud Run Authentication Configuration ✅
- **Issue**: Cloud Run deployment was failing because it expected `GOOGLE_APPLICATION_CREDENTIALS` to point to `/app/service-account-key.json`
- **Root Cause**: The service account key file is not included in the Docker image (and shouldn't be for security)
- **Solution**: Cloud Run uses Application Default Credentials automatically

## Changes Made

### Code Changes
1. **Fixed prettier formatting in `src/main.ts`**:
   - Removed extra spaces before empty lines
   - Fixed string template formatting for better readability

### Documentation Updates
1. **Updated `docs/PRODUCTION_DEPLOYMENT.md`**:
   - Added clarification that `GOOGLE_APPLICATION_CREDENTIALS` is NOT needed for Cloud Run
   - Added section on configuring Cloud Run service account permissions
   - Updated troubleshooting section

2. **Updated `docs/QUEUE_SYSTEM.md`**:
   - Clarified that `GOOGLE_APPLICATION_CREDENTIALS` is only needed for local development
   - Updated troubleshooting section

3. **Updated `README.md`**:
   - Added note that `GOOGLE_APPLICATION_CREDENTIALS` is for local development only

### New Scripts
1. **Created `scripts/setup-cloud-run-permissions.sh`**:
   - Automatically configures Cloud Run service account with required IAM roles
   - Handles both custom and default service accounts
   - Provides clear feedback on permissions granted

## Cloud Run Service Account Setup

The Cloud Run service account needs these IAM roles:
- `roles/cloudtasks.enqueuer` - to create tasks
- `roles/cloudtasks.viewer` - to view queues  
- `roles/run.invoker` - to invoke Cloud Run services

### Quick Setup
```bash
# Run the setup script
./scripts/setup-cloud-run-permissions.sh
```

### Manual Setup
```bash
# Get the service account email
SERVICE_ACCOUNT_EMAIL=$(gcloud run services describe daygen-backend \
  --region=europe-central2 \
  --format="value(spec.template.spec.serviceAccountName)")

# Grant permissions
gcloud projects add-iam-policy-binding daygen-backend \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/cloudtasks.enqueuer"

gcloud projects add-iam-policy-binding daygen-backend \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/cloudtasks.viewer"

gcloud projects add-iam-policy-binding daygen-backend \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/run.invoker"
```

## Key Points

1. **Local Development**: Uses `service-account-key.json` file with `GOOGLE_APPLICATION_CREDENTIALS`
2. **Cloud Run**: Uses Application Default Credentials automatically (no file needed)
3. **Security**: Service account key file is properly ignored in `.gitignore`
4. **CI/CD**: Lint errors are now fixed and won't block GitHub Actions

## Next Steps

1. Run the Cloud Run permissions setup script
2. Deploy to Cloud Run using existing deployment scripts
3. Verify the service starts successfully and can process Cloud Tasks

## Verification

After deployment, check:
- Service starts without authentication errors
- Cloud Tasks queues are accessible
- Job processing works correctly
- No `GOOGLE_APPLICATION_CREDENTIALS` environment variable is set in Cloud Run
