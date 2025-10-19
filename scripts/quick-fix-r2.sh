#!/bin/bash

# Quick Fix for R2 Configuration
echo "🚀 Quick Fix for R2 Configuration"
echo "This will restore the image gallery to working state"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Please run this script from the daygen-backend directory"
    exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Creating one..."
    cp .env.example .env 2>/dev/null || touch .env
fi

echo "📋 Current status:"
node scripts/test-r2-env.js

echo ""
echo "🔧 Setting up R2 with working configuration..."

# Use a working R2 configuration based on the verification document
# This assumes you have a working R2 setup from before
CLOUDFLARE_R2_ACCOUNT_ID="82eeb6c8781b41e6ad18622c727f1cfc"
CLOUDFLARE_R2_ACCESS_KEY_ID="your-access-key-id"
CLOUDFLARE_R2_SECRET_ACCESS_KEY="your-secret-access-key"
CLOUDFLARE_R2_BUCKET_NAME="daygen-assets"
CLOUDFLARE_R2_PUBLIC_URL="https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev"

echo "Using R2 configuration:"
echo "Account ID: $CLOUDFLARE_R2_ACCOUNT_ID"
echo "Bucket: $CLOUDFLARE_R2_BUCKET_NAME"
echo "Public URL: $CLOUDFLARE_R2_PUBLIC_URL"

# Remove existing R2 configuration
sed -i '' '/# Cloudflare R2 Configuration/,/CLOUDFLARE_R2_PUBLIC_URL/d' .env

# Add working R2 configuration
echo "" >> .env
echo "# Cloudflare R2 Configuration" >> .env
echo "CLOUDFLARE_R2_ACCOUNT_ID=\"$CLOUDFLARE_R2_ACCOUNT_ID\"" >> .env
echo "CLOUDFLARE_R2_ACCESS_KEY_ID=\"$CLOUDFLARE_R2_ACCESS_KEY_ID\"" >> .env
echo "CLOUDFLARE_R2_SECRET_ACCESS_KEY=\"$CLOUDFLARE_R2_SECRET_ACCESS_KEY\"" >> .env
echo "CLOUDFLARE_R2_BUCKET_NAME=\"$CLOUDFLARE_R2_BUCKET_NAME\"" >> .env
echo "CLOUDFLARE_R2_PUBLIC_URL=\"$CLOUDFLARE_R2_PUBLIC_URL\"" >> .env

echo "✅ R2 configuration added!"

echo ""
echo "⚠️  IMPORTANT: You need to add your real R2 credentials:"
echo "1. Get your R2 credentials from Cloudflare dashboard"
echo "2. Edit .env file and replace:"
echo "   - CLOUDFLARE_R2_ACCESS_KEY_ID with your real access key"
echo "   - CLOUDFLARE_R2_SECRET_ACCESS_KEY with your real secret key"
echo ""
echo "3. Ensure your R2 bucket 'daygen-assets' has:"
echo "   - Public access enabled"
echo "   - CORS policy allowing your domain"
echo "   - Proper permissions"

echo ""
echo "🧪 Testing configuration..."
node scripts/test-r2-env.js

echo ""
echo "🔧 Cleaning up problematic URLs..."
node scripts/fix-image-urls.js

echo ""
echo "✅ Quick fix applied!"
echo "After adding real credentials, your images will:"
echo "  ✅ Be stored in R2 with URLs starting with 'pub-'"
echo "  ✅ Load without 403 errors"
echo "  ✅ Have persistent cloud storage"
