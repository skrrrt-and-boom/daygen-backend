/**
 * Script to set up R2 bucket structure and test connection
 * Run with: node scripts/setup-r2-bucket.js
 */

const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function setupR2Bucket() {
  console.log('🚀 Setting up R2 bucket structure...\n');

  // Check environment variables
  const requiredEnvVars = [
    'CLOUDFLARE_R2_ACCOUNT_ID',
    'CLOUDFLARE_R2_ACCESS_KEY_ID', 
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'CLOUDFLARE_R2_BUCKET_NAME',
    'CLOUDFLARE_R2_PUBLIC_URL'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('\nPlease set these in your .env file');
    return;
  }

  console.log('✅ All environment variables are set');

  // Initialize S3 client
  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    useAccelerateEndpoint: false,
    disableHostPrefix: true,
  });

  try {
    // Test connection by listing objects
    console.log('\n🔍 Testing R2 connection...');
    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      MaxKeys: 10
    });
    
    const listResult = await s3Client.send(listCommand);
    console.log('✅ Successfully connected to R2');
    console.log(`📦 Bucket: ${process.env.CLOUDFLARE_R2_BUCKET_NAME}`);
    console.log(`🌐 Public URL: ${process.env.CLOUDFLARE_R2_PUBLIC_URL}`);
    
    if (listResult.Contents && listResult.Contents.length > 0) {
      console.log('\n📁 Current objects in bucket:');
      listResult.Contents.forEach(obj => {
        console.log(`   - ${obj.Key} (${obj.Size} bytes, ${obj.LastModified})`);
      });
    } else {
      console.log('\n📁 Bucket is empty');
    }

    // Check if folders exist
    const folders = ['generated-images', 'profile-pictures'];
    const existingFolders = new Set();
    
    if (listResult.Contents) {
      listResult.Contents.forEach(obj => {
        const folder = obj.Key.split('/')[0];
        if (folder && folder.includes('-')) {
          existingFolders.add(folder);
        }
      });
    }

    console.log('\n📂 Checking required folders:');
    for (const folder of folders) {
      if (existingFolders.has(folder)) {
        console.log(`✅ ${folder}/ - exists`);
      } else {
        console.log(`⚠️  ${folder}/ - not found (will be created on first upload)`);
      }
    }

    // Create placeholder files to ensure folders exist
    console.log('\n🔧 Creating folder structure...');
    for (const folder of folders) {
      try {
        const placeholderCommand = new PutObjectCommand({
          Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
          Key: `${folder}/.gitkeep`,
          Body: Buffer.from('This file ensures the folder exists'),
          ContentType: 'text/plain'
        });
        
        await s3Client.send(placeholderCommand);
        console.log(`✅ Created ${folder}/.gitkeep`);
      } catch (error) {
        console.log(`⚠️  Could not create ${folder}/.gitkeep:`, error.message);
      }
    }

    console.log('\n🎉 R2 bucket setup complete!');
    console.log('\n📝 Next steps:');
    console.log('1. Start your backend server: npm run start:dev');
    console.log('2. Start your frontend server: npm run dev');
    console.log('3. Test profile picture upload in the account page');

  } catch (error) {
    console.error('❌ Failed to connect to R2:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Check your R2 credentials in .env file');
    console.error('2. Verify the bucket exists in Cloudflare dashboard');
    console.error('3. Ensure your R2 account has the correct permissions');
  }
}

// Run the setup
setupR2Bucket();
