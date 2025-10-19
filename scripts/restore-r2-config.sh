#!/bin/bash

# Restore R2 Configuration to Working State
echo "🔧 Restoring R2 configuration to working state..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Please run setup-env.sh first."
    exit 1
fi

echo "📋 Current R2 configuration status:"
node scripts/test-r2-env.js

echo ""
echo "🔧 Setting up R2 configuration..."

# Get R2 credentials from user
echo "Please enter your Cloudflare R2 credentials:"
read -p "R2 Account ID: " CLOUDFLARE_R2_ACCOUNT_ID
read -p "R2 Access Key ID: " CLOUDFLARE_R2_ACCESS_KEY_ID
read -p "R2 Secret Access Key: " CLOUDFLARE_R2_SECRET_ACCESS_KEY
read -p "R2 Bucket Name (default: daygen-assets): " CLOUDFLARE_R2_BUCKET_NAME
read -p "R2 Public URL (e.g., https://pub-xxx.r2.dev): " CLOUDFLARE_R2_PUBLIC_URL

# Set defaults
CLOUDFLARE_R2_BUCKET_NAME=${CLOUDFLARE_R2_BUCKET_NAME:-daygen-assets}

# Remove existing R2 configuration
sed -i '' '/# Cloudflare R2 Configuration/,/CLOUDFLARE_R2_PUBLIC_URL/d' .env

# Add new R2 configuration
echo "" >> .env
echo "# Cloudflare R2 Configuration" >> .env
echo "CLOUDFLARE_R2_ACCOUNT_ID=\"${CLOUDFLARE_R2_ACCOUNT_ID}\"" >> .env
echo "CLOUDFLARE_R2_ACCESS_KEY_ID=\"${CLOUDFLARE_R2_ACCESS_KEY_ID}\"" >> .env
echo "CLOUDFLARE_R2_SECRET_ACCESS_KEY=\"${CLOUDFLARE_R2_SECRET_ACCESS_KEY}\"" >> .env
echo "CLOUDFLARE_R2_BUCKET_NAME=\"${CLOUDFLARE_R2_BUCKET_NAME}\"" >> .env
echo "CLOUDFLARE_R2_PUBLIC_URL=\"${CLOUDFLARE_R2_PUBLIC_URL}\"" >> .env

echo "✅ R2 configuration updated!"

# Test the configuration
echo ""
echo "🧪 Testing R2 configuration..."
node scripts/test-r2-env.js

echo ""
echo "🔧 Cleaning up problematic image URLs..."
node scripts/fix-image-urls.js

echo ""
echo "✅ R2 configuration restored to working state!"
echo ""
echo "📋 Next steps:"
echo "1. Ensure your R2 bucket has public access enabled"
echo "2. Verify CORS settings allow your domain"
echo "3. Test image generation to confirm URLs start with 'pub-'"
echo "4. Check gallery to ensure images load without 403 errors"
