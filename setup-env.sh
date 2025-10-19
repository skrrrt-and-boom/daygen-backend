#!/bin/bash

# Setup environment variables for Supabase Auth
echo "Setting up backend environment variables..."

# Get real Supabase keys from the user
echo "Please enter your Supabase project details:"
read -p "Supabase Anon Key: " SUPABASE_ANON_KEY
read -p "Supabase Service Role Key: " SUPABASE_SERVICE_ROLE_KEY

# Get Google OAuth credentials
echo "Please enter your Google OAuth credentials:"
read -p "Google Client ID: " GOOGLE_CLIENT_ID
read -p "Google Client Secret: " GOOGLE_CLIENT_SECRET

# Get Cloudflare R2 credentials
echo "Please enter your Cloudflare R2 credentials:"
read -p "R2 Account ID: " CLOUDFLARE_R2_ACCOUNT_ID
read -p "R2 Access Key ID: " CLOUDFLARE_R2_ACCESS_KEY_ID
read -p "R2 Secret Access Key: " CLOUDFLARE_R2_SECRET_ACCESS_KEY
read -p "R2 Bucket Name (default: daygen-assets): " CLOUDFLARE_R2_BUCKET_NAME
read -p "R2 Public URL (e.g., https://pub-xxx.r2.dev): " CLOUDFLARE_R2_PUBLIC_URL

# Set defaults
CLOUDFLARE_R2_BUCKET_NAME=${CLOUDFLARE_R2_BUCKET_NAME:-daygen-assets}

# Create .env file with real Supabase configuration
cat > .env << EOF
# Database Configuration
DATABASE_URL="postgresql://postgres.kxrxsydlhfkkmvwypcqm:Tltcjvkeik93@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"
DIRECT_URL="postgresql://postgres.kxrxsydlhfkkmvwypcqm:Tltcjvkeik93@db.kxrxsydlhfkkmvwypcqm.supabase.co:5432/postgres"
SHADOW_DATABASE_URL="postgresql://postgres.kxrxsydlhfkkmvwypcqm:Tltcjvkeik93@db.kxrxsydlhfkkmvwypcqm.supabase.co:5432/postgres"

# Supabase Configuration
SUPABASE_URL="https://kxrxsydlhfkkmvwypcqm.supabase.co"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"

# Google OAuth Configuration
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET}"

# Cloudflare R2 Configuration
CLOUDFLARE_R2_ACCOUNT_ID="${CLOUDFLARE_R2_ACCOUNT_ID}"
CLOUDFLARE_R2_ACCESS_KEY_ID="${CLOUDFLARE_R2_ACCESS_KEY_ID}"
CLOUDFLARE_R2_SECRET_ACCESS_KEY="${CLOUDFLARE_R2_SECRET_ACCESS_KEY}"
CLOUDFLARE_R2_BUCKET_NAME="${CLOUDFLARE_R2_BUCKET_NAME}"
CLOUDFLARE_R2_PUBLIC_URL="${CLOUDFLARE_R2_PUBLIC_URL}"

# JWT Secret (for backward compatibility)
JWT_SECRET="your-super-secure-jwt-secret-here"

# Frontend URL for redirects
NEXT_PUBLIC_BASE_URL="http://localhost:3000"
FRONTEND_URL="http://localhost:5173"

# Server Configuration
PORT=3000
NODE_ENV=development
EOF

echo "Backend environment file created with your Supabase keys!"
echo "You can find your keys in your Supabase dashboard under Settings > API"
