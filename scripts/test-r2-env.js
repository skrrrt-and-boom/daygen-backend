require('dotenv').config();

console.log('🔍 Testing R2 Environment Configuration\n');

// Check environment variables
console.log('1️⃣ Environment Variables:');
console.log('CLOUDFLARE_R2_ACCOUNT_ID:', process.env.CLOUDFLARE_R2_ACCOUNT_ID ? 'SET' : 'NOT_SET');
console.log('CLOUDFLARE_R2_ACCESS_KEY_ID:', process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ? 'SET' : 'NOT_SET');
console.log('CLOUDFLARE_R2_SECRET_ACCESS_KEY:', process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ? 'SET' : 'NOT_SET');
console.log('CLOUDFLARE_R2_BUCKET_NAME:', process.env.CLOUDFLARE_R2_BUCKET_NAME || 'NOT_SET');
console.log('CLOUDFLARE_R2_PUBLIC_URL:', process.env.CLOUDFLARE_R2_PUBLIC_URL || 'NOT_SET');

// Check if all required vars are set
const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;

const configured = !!(
  accountId &&
  accessKeyId &&
  secretAccessKey &&
  bucketName &&
  publicUrl
);

console.log('\n2️⃣ Configuration Check:');
console.log('All variables set:', configured);

if (!configured) {
  console.log('❌ R2 not configured - missing environment variables');
  console.log('\nTo fix this, run:');
  console.log('  ./scripts/setup-r2.sh');
  console.log('\nOr manually add these to your .env file:');
  console.log('  CLOUDFLARE_R2_ACCOUNT_ID="your-account-id"');
  console.log('  CLOUDFLARE_R2_ACCESS_KEY_ID="your-access-key-id"');
  console.log('  CLOUDFLARE_R2_SECRET_ACCESS_KEY="your-secret-access-key"');
  console.log('  CLOUDFLARE_R2_BUCKET_NAME="daygen-assets"');
  console.log('  CLOUDFLARE_R2_PUBLIC_URL="https://pub-xxx.r2.dev"');
} else {
  console.log('✅ R2 environment variables are configured!');
  console.log('\nExpected behavior:');
  console.log('  ✅ Images will be uploaded to Cloudflare R2');
  console.log('  ✅ URLs will start with "https://pub-"');
  console.log('  ✅ No more 403 Forbidden errors');
  console.log('  ✅ Persistent cloud storage');
}
