# Database Configuration Fix

## Critical Issue
The current database configuration is causing connection pool exhaustion (P1017 and P2024 errors).

## Solution
Update your `.env` file with the following database configuration:

```env
# Database Configuration - Using Supabase Connection Pooler
# Use port 6543 (transaction pooler) for main connection with connection limiting
DATABASE_URL="postgresql://postgres:[YOUR_PASSWORD]@[YOUR_PROJECT_REF].supabase.co:6543/postgres?pgbouncer=true&connection_limit=10"

# Use port 5432 (direct connection) for migrations
DIRECT_URL="postgresql://postgres:[YOUR_PASSWORD]@[YOUR_PROJECT_REF].supabase.co:5432/postgres"

# Shadow database for Prisma migrations (optional)
SHADOW_DATABASE_URL="postgresql://postgres:[YOUR_PASSWORD]@[YOUR_PROJECT_REF].supabase.co:5432/postgres"
```

## Key Changes
1. **Port 6543**: Use Supabase's transaction pooler for the main DATABASE_URL
2. **pgbouncer=true**: Enable connection pooling
3. **connection_limit=10**: Limit concurrent connections to prevent pool exhaustion
4. **Port 5432**: Use direct connection for migrations via DIRECT_URL

## How to Apply
1. Copy the above configuration to your `.env` file
2. Replace `[YOUR_PASSWORD]` and `[YOUR_PROJECT_REF]` with your actual Supabase credentials
3. Restart your backend server

This will resolve the database connection timeout issues you're experiencing.
