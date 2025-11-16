# R2 Upload Troubleshooting Guide

This guide helps diagnose and fix issues with Cloudflare R2 uploads, particularly signature mismatch errors.

## Common Error: Signature Mismatch

**Error Message:**
```
The request signature we calculated does not match the signature you provided. Check your secret access key and signing method.
```

### Root Causes

1. **Credential Formatting Issues**
   - Extra whitespace or newlines in environment variables
   - Incorrectly encoded characters
   - Truncated credentials

2. **Clock Skew**
   - Time difference between Google Cloud Run and R2 servers
   - AWS S3 signature requires precise clock synchronization

3. **AWS SDK Configuration**
   - Missing signature version configuration
   - Incorrect endpoint or region settings

## Solution Steps

### 1. Verify Environment Variables in Google Cloud Run

Check that all R2 variables are properly set:

```bash
# In Google Cloud Console, go to Cloud Run → Your Service → Variables
# Verify these are set (no extra spaces, no quotes):
CLOUDFLARE_R2_ACCOUNT_ID=<your-account-id>
CLOUDFLARE_R2_ACCESS_KEY_ID=<your-access-key>
CLOUDFLARE_R2_SECRET_ACCESS_KEY=<your-secret-key>
CLOUDFLARE_R2_BUCKET_NAME=<your-bucket-name>
CLOUDFLARE_R2_PUBLIC_URL=<your-public-url>
```

**Important:** 
- Do NOT add quotes around values in Cloud Run
- Do NOT add trailing whitespace
- Copy credentials exactly as shown in Cloudflare dashboard

### 2. Check for Whitespace Issues

The credentials should be trimmed. The updated R2Service now automatically trims all credentials on initialization.

### 3. Verify Credentials Manually

You can test your credentials using the verification script:

```bash
cd daygen-backend
node scripts/verify-r2-credentials.js
```

This script will:
- Check if all environment variables are set
- Validate credential lengths
- Attempt to list objects from the bucket
- Attempt to upload a test file
- Detect signature errors and provide specific guidance

### 4. Check Server Clock

Clock skew can cause signature errors. Verify your server time:

```bash
# On Cloud Run, check the logs for any clock-related warnings
# The signature has a time window, so clocks must be synchronized
```

### 5. Update R2 Credentials (if needed)

If credentials are incorrect:

1. Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens
2. Create a new API token with:
   - Object Read & Write permissions
   - Bucket: Your bucket name
3. Update all five environment variables in Google Cloud Run:
   - `CLOUDFLARE_R2_ACCOUNT_ID` - Found in R2 dashboard URL or Settings
   - `CLOUDFLARE_R2_ACCESS_KEY_ID` - From the API token
   - `CLOUDFLARE_R2_SECRET_ACCESS_KEY` - From the API token (shown once)
   - `CLOUDFLARE_R2_BUCKET_NAME` - Your bucket name
   - `CLOUDFLARE_R2_PUBLIC_URL` - Your custom domain or R2.dev URL
4. Redeploy the Cloud Run service

### 6. Verify Bucket Permissions

Ensure the bucket allows public read access if you're serving public URLs:

1. Go to Cloudflare R2 → Your Bucket → Settings
2. Enable "Public Access" if serving public URLs
3. Configure Custom Domain or get R2.dev URL

## Implementation Details

The updated R2Service includes:

1. **Credential Trimming** - All credentials are trimmed to remove whitespace
2. **Credential Validation** - Fails fast on malformed credentials with detailed errors
3. **Signature Version** - Explicitly sets AWS signature version 4 for R2 compatibility
4. **Better Error Messages** - Provides specific guidance for signature errors
5. **Comprehensive Logging** - Logs all R2 operations for debugging

## Testing After Fix

1. Deploy the updated backend to Cloud Run
2. Check the logs for "R2 credentials validated successfully"
3. Try generating an image with Gemini
4. Monitor the job logs for successful R2 upload
5. Verify the generated image URL is an R2 URL (not base64)

## Additional Resources

- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [AWS S3 SDK for R2](https://developers.cloudflare.com/r2/reference/s3-api/)
- [R2 Configuration in Backend](../src/upload/r2.service.ts)

