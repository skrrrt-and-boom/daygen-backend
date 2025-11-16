#!/usr/bin/env node

/**
 * Helper script to get the correct Supavisor connection string for backups
 * This avoids IPv6 connectivity issues on GitHub Actions
 */

console.log(`
🔧 Supabase Connection Helper

To fix IPv6 connection issues, you need to use Supavisor (connection pooler) instead of direct connection.

📋 Steps to get the correct connection string:

1. Go to your Supabase project dashboard
2. Navigate to: Settings > Database > Connection Pooling
3. Copy the "Session pooler" connection string
4. It should look like:
   postgresql://postgres.[ref]:[password]@aws-1-eu-central-1.pooler.supabase.com:6543/postgres

🔍 Current DATABASE_URL analysis:
`);

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.log('❌ DATABASE_URL not set');
  process.exit(1);
}

console.log(`✅ DATABASE_URL is set (length: ${dbUrl.length})`);

// Extract host information
const hostMatch = dbUrl.match(/@([^:/?]+)/);
if (hostMatch) {
  const host = hostMatch[1];
  console.log(`📍 Current host: ${host}`);
  
  if (host.includes('pooler.supabase.com')) {
    console.log('✅ Already using Supavisor (IPv4 compatible)');
  } else if (host.includes('supabase.co')) {
    console.log('⚠️ Using direct connection - may have IPv6 issues');
    console.log('💡 Switch to Supavisor connection string for better compatibility');
  } else {
    console.log('ℹ️ Unknown host type');
  }
} else {
  console.log('❌ Could not parse host from DATABASE_URL');
}

console.log(`
🛠️ To update your GitHub secret:

1. Go to your repository on GitHub
2. Navigate to: Settings > Secrets and variables > Actions
3. Update the DATABASE_URL secret with the Supavisor connection string

📚 For more information:
- Supabase Docs: https://supabase.com/docs/guides/database/connecting-to-postgres
- Connection Pooling: https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooling
`);
