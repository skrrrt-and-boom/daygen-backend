#!/usr/bin/env node

/**
 * Test script for R2 migration functionality
 * Tests the batch migration endpoint with sample base64 images
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');
require('dotenv').config();

// Test configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_TOKEN = process.env.TEST_JWT_TOKEN || 'test-token';

// Sample base64 images for testing
const SAMPLE_IMAGES = [
  {
    base64Data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    mimeType: 'image/png',
    prompt: 'Test image 1',
    model: 'test-model',
    originalUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  },
  {
    base64Data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/8A8A',
    mimeType: 'image/jpeg',
    prompt: 'Test image 2',
    model: 'test-model-2',
    originalUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/8A8A',
  },
];

async function testR2Configuration() {
  console.log('🔍 Testing R2 Configuration\n');
  
  // Check environment variables
  const requiredVars = [
    'CLOUDFLARE_R2_ACCOUNT_ID',
    'CLOUDFLARE_R2_ACCESS_KEY_ID',
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'CLOUDFLARE_R2_BUCKET_NAME',
    'CLOUDFLARE_R2_PUBLIC_URL',
  ];

  let allConfigured = true;
  for (const varName of requiredVars) {
    const value = process.env[varName];
    console.log(`${varName}: ${value ? 'SET' : 'NOT_SET'}`);
    if (!value) {
      allConfigured = false;
    }
  }

  if (!allConfigured) {
    console.log('\n❌ R2 not properly configured - missing environment variables');
    return false;
  }

  // Test S3Client initialization
  try {
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

    console.log('\n✅ S3Client created successfully');
    return true;
  } catch (error) {
    console.log('\n❌ S3Client initialization failed:', error.message);
    return false;
  }
}

async function testMigrationEndpoint() {
  console.log('\n🔄 Testing Migration Endpoint\n');

  try {
    const response = await fetch(`${API_BASE_URL}/api/upload/migrate-base64-batch`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        images: SAMPLE_IMAGES,
      }),
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('❌ Migration endpoint failed:', errorText);
      return false;
    }

    const result = await response.json();
    console.log('✅ Migration endpoint response:', JSON.stringify(result, null, 2));

    // Validate response structure
    if (!result.success && result.success !== false) {
      console.log('❌ Invalid response structure - missing success field');
      return false;
    }

    if (typeof result.totalImages !== 'number') {
      console.log('❌ Invalid response structure - missing totalImages field');
      return false;
    }

    if (!Array.isArray(result.results)) {
      console.log('❌ Invalid response structure - missing results array');
      return false;
    }

    if (!Array.isArray(result.errors)) {
      console.log('❌ Invalid response structure - missing errors array');
      return false;
    }

    console.log(`\n📊 Migration Results:`);
    console.log(`- Total images: ${result.totalImages}`);
    console.log(`- Successful migrations: ${result.successfulMigrations}`);
    console.log(`- Failed migrations: ${result.failedMigrations}`);

    if (result.results.length > 0) {
      console.log('\n✅ Successfully migrated images:');
      result.results.forEach((item, index) => {
        console.log(`  ${index + 1}. ${item.originalUrl} -> ${item.newUrl}`);
      });
    }

    if (result.errors.length > 0) {
      console.log('\n❌ Migration errors:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.originalUrl}: ${error.error}`);
      });
    }

    return result.successfulMigrations > 0;

  } catch (error) {
    console.log('❌ Migration endpoint test failed:', error.message);
    return false;
  }
}

async function testR2FileAccess() {
  console.log('\n🌐 Testing R2 File Access\n');

  try {
    // First, run migration to get some R2 URLs
    const migrationResponse = await fetch(`${API_BASE_URL}/api/upload/migrate-base64-batch`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        images: SAMPLE_IMAGES.slice(0, 1), // Test with just one image
      }),
    });

    if (!migrationResponse.ok) {
      console.log('❌ Migration failed, cannot test R2 file access');
      return false;
    }

    const migrationResult = await migrationResponse.json();
    if (migrationResult.results.length === 0) {
      console.log('❌ No images were migrated, cannot test R2 file access');
      return false;
    }

    const r2Url = migrationResult.results[0].newUrl;
    console.log(`Testing R2 URL: ${r2Url}`);

    // Test if the R2 URL is accessible
    const imageResponse = await fetch(r2Url);
    
    if (!imageResponse.ok) {
      console.log(`❌ R2 URL not accessible: ${imageResponse.status} ${imageResponse.statusText}`);
      return false;
    }

    const contentType = imageResponse.headers.get('content-type');
    const contentLength = imageResponse.headers.get('content-length');

    console.log(`✅ R2 URL is accessible`);
    console.log(`- Content-Type: ${contentType}`);
    console.log(`- Content-Length: ${contentLength}`);

    // Test CORS headers
    const corsHeaders = [
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
    ];

    console.log('\n🔒 CORS Headers:');
    corsHeaders.forEach(header => {
      const value = imageResponse.headers.get(header);
      console.log(`- ${header}: ${value || 'NOT_SET'}`);
    });

    return true;

  } catch (error) {
    console.log('❌ R2 file access test failed:', error.message);
    return false;
  }
}

async function testR2FilesEndpoint() {
  console.log('\n📁 Testing R2Files Endpoint\n');

  try {
    const response = await fetch(`${API_BASE_URL}/api/r2files`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('❌ R2Files endpoint failed:', errorText);
      return false;
    }

    const result = await response.json();
    console.log('✅ R2Files endpoint response:', JSON.stringify(result, null, 2));

    // Validate response structure
    if (!result.items || !Array.isArray(result.items)) {
      console.log('❌ Invalid response structure - missing items array');
      return false;
    }

    console.log(`\n📊 R2Files Results:`);
    console.log(`- Total files: ${result.items.length}`);
    console.log(`- Total count: ${result.totalCount || 'N/A'}`);

    if (result.items.length > 0) {
      console.log('\n✅ Files found:');
      result.items.forEach((file, index) => {
        console.log(`  ${index + 1}. ${file.fileName} -> ${file.fileUrl}`);
      });
    }

    return true;

  } catch (error) {
    console.log('❌ R2Files endpoint test failed:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Starting R2 Migration Tests\n');
  console.log('=' .repeat(50));

  const results = {
    r2Config: false,
    migrationEndpoint: false,
    r2FileAccess: false,
    r2FilesEndpoint: false,
  };

  // Test 1: R2 Configuration
  results.r2Config = await testR2Configuration();

  // Test 2: Migration Endpoint
  if (results.r2Config) {
    results.migrationEndpoint = await testMigrationEndpoint();
  }

  // Test 3: R2 File Access
  if (results.migrationEndpoint) {
    results.r2FileAccess = await testR2FileAccess();
  }

  // Test 4: R2Files Endpoint
  results.r2FilesEndpoint = await testR2FilesEndpoint();

  // Summary
  console.log('\n' + '=' .repeat(50));
  console.log('📋 Test Summary\n');

  const testNames = {
    r2Config: 'R2 Configuration',
    migrationEndpoint: 'Migration Endpoint',
    r2FileAccess: 'R2 File Access',
    r2FilesEndpoint: 'R2Files Endpoint',
  };

  let allPassed = true;
  Object.entries(results).forEach(([key, passed]) => {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${testNames[key]}: ${status}`);
    if (!passed) allPassed = false;
  });

  console.log('\n' + '=' .repeat(50));
  if (allPassed) {
    console.log('🎉 All tests passed! R2 migration is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Please check the configuration and try again.');
  }

  return allPassed;
}

// Run tests if this script is executed directly
if (require.main === module) {
  runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner failed:', error);
      process.exit(1);
    });
}

module.exports = {
  testR2Configuration,
  testMigrationEndpoint,
  testR2FileAccess,
  testR2FilesEndpoint,
  runAllTests,
};
