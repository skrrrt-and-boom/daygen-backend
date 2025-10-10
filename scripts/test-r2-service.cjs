#!/usr/bin/env node

/**
 * Test R2 service directly
 */

const { S3Client } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: '/Users/jakubst/Desktop/daygen-backend/.env' });

async function testR2Service() {
  console.log('🔍 Testing R2 Service Directly\n');
  
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
    return;
  }
  
  // Test S3Client initialization
  console.log('\n3️⃣ Testing S3Client initialization...');
  try {
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
      },
    });
    console.log('✅ S3Client created successfully');
    
    // Test a simple operation
    console.log('\n4️⃣ Testing R2 connection...');
    const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      MaxKeys: 1
    });
    
    try {
      const result = await s3Client.send(command);
      console.log('✅ R2 connection successful');
      console.log('Bucket contents count:', result.KeyCount || 0);
    } catch (error) {
      console.log('❌ R2 connection failed:', error.message);
      if (error.message.includes('InvalidAccessKeyId')) {
        console.log('   → Check your R2 API credentials');
      } else if (error.message.includes('NoSuchBucket')) {
        console.log('   → Check your bucket name');
      } else if (error.message.includes('AccessDenied')) {
        console.log('   → Check your R2 API permissions');
      }
    }
    
  } catch (error) {
    console.log('❌ S3Client initialization failed:', error.message);
  }
}

testR2Service();
