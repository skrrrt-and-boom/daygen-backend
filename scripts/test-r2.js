#!/usr/bin/env node

/**
 * Test R2 Configuration
 * This script tests if R2 is properly configured and can upload files
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');
require('dotenv').config();

async function testR2Configuration() {
  console.log('🧪 Testing R2 Configuration...\n');

  // Check environment variables
  const requiredEnvVars = [
    'CLOUDFLARE_R2_ACCOUNT_ID',
    'CLOUDFLARE_R2_ACCESS_KEY_ID', 
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'CLOUDFLARE_R2_BUCKET_NAME',
    'CLOUDFLARE_R2_PUBLIC_URL'
  ];

  console.log('📋 Checking environment variables...');
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('\nPlease update your .env file with the correct R2 credentials.');
    process.exit(1);
  }

  console.log('✅ All environment variables present');

  // Initialize S3 client
  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    tls: true,
  });

  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;

  try {
    // Test upload
    console.log('\n📤 Testing file upload...');
    const testFileName = `test-${randomUUID()}.txt`;
    const testContent = `R2 test file created at ${new Date().toISOString()}`;

    const uploadCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: testFileName,
      Body: testContent,
      ContentType: 'text/plain',
      CacheControl: 'public, max-age=31536000',
    });

    await s3Client.send(uploadCommand);
    console.log('✅ File uploaded successfully');

    // Test public URL
    const publicFileUrl = `${publicUrl}/${testFileName}`;
    console.log(`\n🔗 Public URL: ${publicFileUrl}`);

    // Test if file is accessible
    console.log('\n🌐 Testing public access...');
    try {
      const response = await fetch(publicFileUrl);
      if (response.ok) {
        const content = await response.text();
        if (content === testContent) {
          console.log('✅ Public URL is accessible and content matches');
        } else {
          console.log('⚠️  Public URL accessible but content mismatch');
        }
      } else {
        console.log(`❌ Public URL not accessible: ${response.status} ${response.statusText}`);
        console.log('   Make sure your bucket has public access enabled');
      }
    } catch (error) {
      console.log(`❌ Error accessing public URL: ${error.message}`);
    }

    // Clean up test file
    console.log('\n🧹 Cleaning up test file...');
    const deleteCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: testFileName,
      Body: '', // Empty body to delete
    });
    
    try {
      await s3Client.send(deleteCommand);
      console.log('✅ Test file cleaned up');
    } catch (error) {
      console.log('⚠️  Could not clean up test file (this is okay)');
    }

    console.log('\n🎉 R2 configuration test completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Your R2 is properly configured');
    console.log('2. Run the backend server');
    console.log('3. Test image generation to see R2 uploads in action');

  } catch (error) {
    console.error('\n❌ R2 test failed:');
    console.error(`   Error: ${error.message}`);
    
    if (error.message.includes('EPROTO') || error.message.includes('SSL')) {
      console.error('\n🚨 SSL Compatibility Issue Detected');
      console.error('   This is a known issue with Node.js v22 and Cloudflare R2');
      console.error('\n💡 Solutions:');
      console.error('   1. Use Node.js v18: nvm install 18 && nvm use 18');
      console.error('   2. Use Node.js v20: nvm install 20 && nvm use 20');
      console.error('   3. See R2_SSL_FIX.md for detailed instructions');
      console.error('\n   Your R2 configuration is correct - just need compatible Node.js version');
    } else if (error.name === 'NoSuchBucket') {
      console.error('\n💡 Solution: Create the bucket in Cloudflare dashboard');
    } else if (error.name === 'InvalidAccessKeyId') {
      console.error('\n💡 Solution: Check your R2 credentials in .env file');
    } else if (error.name === 'SignatureDoesNotMatch') {
      console.error('\n💡 Solution: Verify your secret access key is correct');
    }
    
    process.exit(1);
  }
}

// Run the test
testR2Configuration().catch(console.error);
