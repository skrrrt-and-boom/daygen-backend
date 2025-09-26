# 🚀 Cloudflare R2 Quick Setup Guide

## ✅ **What's Already Done**

Your backend is now **fully configured** for Cloudflare R2! Here's what I've set up:

### Backend Features ✅
- **R2 Service**: Handles file uploads, downloads, and deletions
- **Upload Endpoints**: `/api/upload/file`, `/api/upload/base64`, `/api/upload/presigned`
- **Gallery Integration**: Automatically deletes R2 files when gallery entries are removed
- **Error Handling**: Falls back to base64 if R2 is unavailable

### Frontend Features ✅
- **R2 Upload Utils**: `src/utils/r2Upload.ts` with all upload functions
- **Auto-Upload**: Generated images automatically upload to R2
- **Fallback**: Uses base64 if R2 upload fails

## 🔧 **What You Need to Do (5 minutes)**

### 1. Create R2 Bucket
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click **R2 Object Storage** → **Create bucket**
3. Name: `daygen-assets`
4. Click **Create bucket**

### 2. Make it Public
1. Go to your bucket → **Settings** → **Public access**
2. Click **Allow Access**
3. Copy the **Public URL** (looks like: `https://pub-xxxxx.r2.dev`)

### 3. Get Your Keys
1. Go to **R2** → **Manage R2 API tokens**
2. Click **Create API token** → **Custom token**
3. Set permissions: **Cloudflare R2:Edit**
4. Copy these 3 values:
   - **Account ID**
   - **Access Key ID** 
   - **Secret Access Key**

### 4. Update Backend Environment Variables
Run this command with your actual values:

```bash
gcloud run services update daygen-backend \
  --region europe-central2 \
  --set-env-vars \
  CLOUDFLARE_R2_ACCOUNT_ID=your_actual_account_id,\
  CLOUDFLARE_R2_ACCESS_KEY_ID=your_actual_access_key,\
  CLOUDFLARE_R2_SECRET_ACCESS_KEY=your_actual_secret_key,\
  CLOUDFLARE_R2_BUCKET_NAME=daygen-assets,\
  CLOUDFLARE_R2_PUBLIC_URL=https://pub-your-actual-url.r2.dev
```

## 🎯 **How It Works**

1. **User generates image** → Backend creates image
2. **Backend uploads to R2** → Gets R2 URL like `https://pub-xxxxx.r2.dev/image.png`
3. **Backend saves R2 URL** → Stores in Supabase database
4. **Frontend displays image** → Shows image from R2 URL

## 🧪 **Test It**

1. **Deploy your frontend** to Vercel
2. **Generate an image** using any model
3. **Check the gallery** - images should have R2 URLs instead of base64
4. **Delete a gallery entry** - file should be removed from R2

## 📊 **Benefits You Get**

- ✅ **Faster loading** - Images load from CDN
- ✅ **Lower costs** - No egress fees
- ✅ **Better performance** - Global CDN
- ✅ **Automatic cleanup** - Files deleted when gallery entries removed
- ✅ **Fallback support** - Works even if R2 is down

## 🔍 **Troubleshooting**

### If uploads fail:
- Check your R2 credentials are correct
- Verify the bucket exists and is public
- Check Cloud Run logs: `gcloud logs read --service=daygen-backend`

### If images don't show:
- Check the R2 public URL is correct
- Verify CORS is configured (should work automatically)

## 💰 **Cost Estimate**

For a typical image generation app:
- **Storage**: ~$0.50/month for 1000 images
- **Uploads**: ~$0.50/month for 1000 uploads  
- **Downloads**: ~$0.50/month for 10,000 views
- **Total**: ~$1.50/month (very cheap!)

---

**That's it!** Your app now uses Cloudflare R2 for fast, cheap, reliable image storage! 🎉
