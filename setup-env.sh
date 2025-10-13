#!/bin/bash

# Setup environment variables for Supabase Auth
echo "Setting up backend environment variables..."

# Get real Supabase keys from the user
echo "Please enter your Supabase project details:"
read -p "Supabase Anon Key: " SUPABASE_ANON_KEY
read -p "Supabase Service Role Key: " SUPABASE_SERVICE_ROLE_KEY

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
