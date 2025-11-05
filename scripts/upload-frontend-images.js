#!/usr/bin/env node

/**
 * Upload Frontend Images to R2
 * 
 * Uploads specific frontend images to Cloudflare R2 bucket
 * under 'website-assets' directory.
 */

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Load environment variables
require('dotenv').config();

// Configuration
const FRONTEND_PUBLIC_DIR = path.join(__dirname, '../../daygen0/public');
const R2_FOLDER = 'website-assets';
const BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME?.trim() || 'daygen-assets';

// Files to upload (only these specific files)
const FILES_TO_UPLOAD = [
  'black_suit_studio setup.png',
  'french_balcony.png',
  'boat_in_coastal_town.png',
  'brick_in_the_wall.png',
  'smoking_hot.png',
  'sun_and_sea.png',
  'favicon16px.png',
  'favicon32px.png',
  'favicon48.png', // Note: file is favicon48.png but referenced as favicon48px.png
  'favicon180px.png',
];

// R2 Configuration
const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID?.trim();
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY?.trim();
const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL?.trim();

// Validate configuration
if (!accountId || !accessKeyId || !secretAccessKey || !BUCKET_NAME || !publicUrl) {
  console.error('❌ Missing R2 configuration. Please check your .env file:');
  console.error('   CLOUDFLARE_R2_ACCOUNT_ID:', accountId ? '✓' : '❌');
  console.error('   CLOUDFLARE_R2_ACCESS_KEY_ID:', accessKeyId ? '✓' : '❌');
  console.error('   CLOUDFLARE_R2_SECRET_ACCESS_KEY:', secretAccessKey ? '✓' : '❌');
  console.error('   CLOUDFLARE_R2_BUCKET_NAME:', BUCKET_NAME ? '✓' : '❌');
  console.error('   CLOUDFLARE_R2_PUBLIC_URL:', publicUrl ? '✓' : '❌');
  process.exit(1);
}

// Initialize S3 client for R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  forcePathStyle: true,
  useAccelerateEndpoint: false,
  disableHostPrefix: true,
});

/**
 * Get MIME type from file extension
 */
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Upload file to R2
 */
async function uploadFileToR2(filePath, fileName) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = getMimeType(fileName);
    
    // Create R2 key with folder prefix
    const r2Key = `${R2_FOLDER}/${fileName}`;
    
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: r2Key,
      Body: fileBuffer,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000', // Cache for 1 year
    });

    await s3Client.send(command);
    
    const r2Url = `${publicUrl}/${r2Key}`;
    console.log(`✅ Uploaded: ${fileName}`);
    console.log(`   → ${r2Url}`);
    
    return {
      fileName,
      r2Url,
      r2Key,
      size: fileBuffer.length,
      mimeType
    };
  } catch (error) {
    console.error(`❌ Failed to upload ${fileName}:`, error.message);
    throw error;
  }
}

/**
 * Main upload function
 */
async function uploadImages() {
  console.log('🚀 Starting frontend images upload to R2...');
  console.log(`📁 Source directory: ${FRONTEND_PUBLIC_DIR}`);
  console.log(`🪣 R2 bucket: ${BUCKET_NAME}`);
  console.log(`📂 R2 folder: ${R2_FOLDER}`);
  console.log(`🌐 Public URL: ${publicUrl}`);
  console.log('');

  // Check if source directory exists
  if (!fs.existsSync(FRONTEND_PUBLIC_DIR)) {
    console.error(`❌ Source directory not found: ${FRONTEND_PUBLIC_DIR}`);
    process.exit(1);
  }

  const uploadResults = [];
  let successCount = 0;
  let errorCount = 0;

  // Upload each file
  for (const filename of FILES_TO_UPLOAD) {
    const filePath = path.join(FRONTEND_PUBLIC_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      console.error(`⚠️  File not found: ${filename}`);
      errorCount++;
      continue;
    }

    try {
      const result = await uploadFileToR2(filePath, filename);
      uploadResults.push(result);
      successCount++;
    } catch (error) {
      errorCount++;
      console.error(`❌ Failed to upload ${filename}`);
    }
  }

  console.log('');
  console.log('📊 Upload Summary:');
  console.log(`   ✅ Successfully uploaded: ${successCount}`);
  console.log(`   ❌ Failed uploads: ${errorCount}`);
  console.log('');
  
  if (successCount > 0) {
    console.log('🎉 Images successfully uploaded to R2!');
    console.log('');
    console.log('📝 Uploaded URLs:');
    uploadResults.forEach(result => {
      console.log(`   ${result.fileName}`);
      console.log(`   ${result.r2Url}`);
      console.log('');
    });
  }

  if (errorCount > 0) {
    console.log('⚠️  Some uploads failed. Please check the errors above.');
    process.exit(1);
  }
}

// Run the upload
uploadImages().catch(error => {
  console.error('💥 Upload process failed:', error);
  process.exit(1);
});

