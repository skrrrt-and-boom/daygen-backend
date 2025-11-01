#!/usr/bin/env node

/**
 * R2 Credential Verification Script
 * 
 * This script tests the R2 connection and credentials to help diagnose
 * signature mismatch errors.
 * 
 * Usage:
 *   node scripts/verify-r2-credentials.js
 * 
 * Make sure your .env file has the R2 credentials set up.
 */

const { S3Client, PutObjectCommand, ListObjectsCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function verifyR2Credentials() {
  console.log('🔍 Verifying R2 Credentials...\n');

  // Get and trim credentials
  const accountId = (process.env.CLOUDFLARE_R2_ACCOUNT_ID || '').trim();
  const accessKeyId = (process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '').trim();
  const bucketName = (process.env.CLOUDFLARE_R2_BUCKET_NAME || '').trim();
  const publicUrl = (process.env.CLOUDFLARE_R2_PUBLIC_URL || '').trim();

  // Validate credentials
  console.log('📋 Checking environment variables...');
  const checks = [
    { name: 'CLOUDFLARE_R2_ACCOUNT_ID', value: accountId, isValid: !!accountId && accountId.length >= 32 },
    { name: 'CLOUDFLARE_R2_ACCESS_KEY_ID', value: accessKeyId, isValid: !!accessKeyId && accessKeyId.length >= 20 },
    { name: 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', value: secretAccessKey, isValid: !!secretAccessKey && secretAccessKey.length >= 40 },
    { name: 'CLOUDFLARE_R2_BUCKET_NAME', value: bucketName, isValid: !!bucketName },
    { name: 'CLOUDFLARE_R2_PUBLIC_URL', value: publicUrl, isValid: !!publicUrl },
  ];

  let hasErrors = false;
  for (const check of checks) {
    if (!check.isValid) {
      console.error(`❌ ${check.name}: ${check.value ? `Invalid value (length: ${check.value.length})` : 'MISSING'}`);
      hasErrors = true;
    } else {
      console.log(`✅ ${check.name}: Set (length: ${check.value.length})`);
    }
  }

  if (hasErrors) {
    console.error('\n❌ Credential validation failed. Please check your .env file.');
    process.exit(1);
  }

  console.log('\n🔗 Creating S3Client...');
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  
  const s3Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
    useAccelerateEndpoint: false,
    disableHostPrefix: true,
    signatureVersion: 'v4',
  });

  console.log(`✅ S3Client created with endpoint: ${endpoint}`);

  // Test 1: List objects
  console.log('\n📦 Test 1: Listing bucket objects...');
  try {
    const listCommand = new ListObjectsCommand({ Bucket: bucketName, MaxKeys: 5 });
    const response = await s3Client.send(listCommand);
    console.log(`✅ Successfully listed objects from bucket: ${bucketName}`);
    console.log(`   Found ${response.Contents?.length || 0} objects (showing first 5)`);
  } catch (error) {
    console.error('❌ Failed to list objects:', error.message);
    if (error.message.includes('signature')) {
      console.error('\n⚠️  SIGNATURE ERROR DETECTED!');
      console.error('\nThis usually means:');
      console.error('1. Credentials have extra spaces or newlines');
      console.error('2. Clock skew between your server and R2');
      console.error('3. Incorrect credentials');
      console.error('\nTroubleshooting:');
      console.error('- Check .env file for any whitespace in credentials');
      console.error('- Verify credentials in Cloudflare R2 dashboard');
      console.error('- Check system clock is synchronized');
    }
    throw error;
  }

  // Test 2: Upload a test file
  console.log('\n📤 Test 2: Uploading test file...');
  try {
    const testFileName = `test-${Date.now()}.txt`;
    const testContent = 'R2 connection test';
    const uploadCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: testFileName,
      Body: Buffer.from(testContent),
      ContentType: 'text/plain',
    });

    await s3Client.send(uploadCommand);
    console.log(`✅ Successfully uploaded test file: ${testFileName}`);
    
    if (publicUrl) {
      const publicUrlFull = `${publicUrl}/${testFileName}`;
      console.log(`   Public URL: ${publicUrlFull}`);
    }
  } catch (error) {
    console.error('❌ Failed to upload test file:', error.message);
    if (error.message.includes('signature')) {
      console.error('\n⚠️  SIGNATURE ERROR DETECTED!');
      console.error('\nThis usually means:');
      console.error('1. Credentials have extra spaces or newlines');
      console.error('2. Clock skew between your server and R2');
      console.error('3. Incorrect credentials');
      console.error('\nTroubleshooting:');
      console.error('- Check .env file for any whitespace in credentials');
      console.error('- Verify credentials in Cloudflare R2 dashboard');
      console.error('- Check system clock is synchronized');
    }
    throw error;
  }

  console.log('\n✅ All R2 connection tests passed!');
  console.log('\nYour R2 configuration looks good. If you still get signature errors,');
  console.log('check the server logs in Cloud Run for more details.');
}

// Run the verification
verifyR2Credentials().catch((error) => {
  console.error('\n❌ Verification failed:', error.message);
  process.exit(1);
});

