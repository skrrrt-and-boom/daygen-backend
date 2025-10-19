#!/bin/bash

# Add placeholder R2 configuration to .env file
echo "Adding placeholder R2 configuration to .env file..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Please run setup-env.sh first."
    exit 1
fi

# Check if R2 config already exists
if grep -q "CLOUDFLARE_R2_ACCOUNT_ID" .env; then
    echo "⚠️  R2 configuration already exists in .env file"
    echo "Current R2 config:"
    grep "CLOUDFLARE_R2" .env
    exit 0
fi

# Add placeholder R2 configuration
echo "" >> .env
echo "# Cloudflare R2 Configuration (PLACEHOLDER - REPLACE WITH REAL VALUES)" >> .env
echo "CLOUDFLARE_R2_ACCOUNT_ID=\"your-account-id\"" >> .env
echo "CLOUDFLARE_R2_ACCESS_KEY_ID=\"your-access-key-id\"" >> .env
echo "CLOUDFLARE_R2_SECRET_ACCESS_KEY=\"your-secret-access-key\"" >> .env
echo "CLOUDFLARE_R2_BUCKET_NAME=\"daygen-assets\"" >> .env
echo "CLOUDFLARE_R2_PUBLIC_URL=\"https://pub-xxx.r2.dev\"" >> .env

echo "✅ Placeholder R2 configuration added to .env file!"
echo ""
echo "⚠️  IMPORTANT: Replace the placeholder values with your real R2 credentials:"
echo "   1. Get your R2 credentials from Cloudflare dashboard"
echo "   2. Edit .env file and replace the placeholder values"
echo "   3. Or run: ./scripts/setup-r2.sh"
echo ""
echo "After configuring R2, run: node scripts/test-r2-env.js"
