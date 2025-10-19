#!/bin/bash

# Setup Cloudflare R2 Configuration
echo "Setting up Cloudflare R2 configuration..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Please run setup-env.sh first."
    exit 1
fi

# Get R2 credentials from user
echo "Please enter your Cloudflare R2 credentials:"
read -p "R2 Account ID: " CLOUDFLARE_R2_ACCOUNT_ID
read -p "R2 Access Key ID: " CLOUDFLARE_R2_ACCESS_KEY_ID
read -p "R2 Secret Access Key: " CLOUDFLARE_R2_SECRET_ACCESS_KEY
read -p "R2 Bucket Name (default: daygen-assets): " CLOUDFLARE_R2_BUCKET_NAME
read -p "R2 Public URL (e.g., https://pub-xxx.r2.dev): " CLOUDFLARE_R2_PUBLIC_URL

# Set defaults
CLOUDFLARE_R2_BUCKET_NAME=${CLOUDFLARE_R2_BUCKET_NAME:-daygen-assets}

# Add R2 configuration to .env file
echo "" >> .env
echo "# Cloudflare R2 Configuration" >> .env
echo "CLOUDFLARE_R2_ACCOUNT_ID=\"${CLOUDFLARE_R2_ACCOUNT_ID}\"" >> .env
echo "CLOUDFLARE_R2_ACCESS_KEY_ID=\"${CLOUDFLARE_R2_ACCESS_KEY_ID}\"" >> .env
echo "CLOUDFLARE_R2_SECRET_ACCESS_KEY=\"${CLOUDFLARE_R2_SECRET_ACCESS_KEY}\"" >> .env
echo "CLOUDFLARE_R2_BUCKET_NAME=\"${CLOUDFLARE_R2_BUCKET_NAME}\"" >> .env
echo "CLOUDFLARE_R2_PUBLIC_URL=\"${CLOUDFLARE_R2_PUBLIC_URL}\"" >> .env

echo "✅ R2 configuration added to .env file!"
echo ""
echo "Testing R2 configuration..."

# Test R2 configuration
node scripts/test-r2-config.js

echo ""
echo "🎉 R2 setup complete!"
echo "Your images will now be stored in Cloudflare R2 with URLs starting with 'pub'."
