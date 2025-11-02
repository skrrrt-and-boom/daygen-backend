#!/usr/bin/env node

/**
 * Upload Static Assets to R2
 * 
 * This script uploads all static images from the frontend public folder
 * to Cloudflare R2 under the website-assets/ directory.
 */

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');

// Load environment variables
require('dotenv').config();

// Configuration
const FRONTEND_PUBLIC_DIR = path.join(__dirname, '../../daygen0/public');
const R2_FOLDER = 'website-assets';
const MAPPING_FILE = path.join(__dirname, 'static-assets-map.json');

// Image file extensions to upload
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

// Files to exclude (keep in public folder)
const EXCLUDE_FILES = [
  'robots.txt',
  'sitemap.xml',
  'auth.html',
  'test-chatgpt.html',
  'vite.svg'
];

// R2 Configuration
const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID?.trim();
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY?.trim();
const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME?.trim() || 'daygen-assets';
const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL?.trim();

// Validate configuration
if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
  console.error('❌ Missing R2 configuration. Please check your .env file:');
  console.error('   CLOUDFLARE_R2_ACCOUNT_ID:', accountId ? '✓' : '❌');
  console.error('   CLOUDFLARE_R2_ACCESS_KEY_ID:', accessKeyId ? '✓' : '❌');
  console.error('   CLOUDFLARE_R2_SECRET_ACCESS_KEY:', secretAccessKey ? '✓' : '❌');
  console.error('   CLOUDFLARE_R2_BUCKET_NAME:', bucketName ? '✓' : '❌');
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
 * Get file extension from filename
 */
function getFileExtension(filename) {
  const lastDot = filename.lastIndexOf('.');
  return lastDot !== -1 ? filename.substring(lastDot) : '';
}

/**
 * Check if file is an image
 */
function isImageFile(filename) {
  const ext = getFileExtension(filename).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename) {
  const ext = getFileExtension(filename).toLowerCase();
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
async function uploadFileToR2(filePath, originalName) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = getMimeType(originalName);
    
    // Create R2 key with website-assets/ prefix
    const r2Key = `${R2_FOLDER}/${originalName}`;
    
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: r2Key,
      Body: fileBuffer,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000', // Cache for 1 year
    });

    await s3Client.send(command);
    
    const r2Url = `${publicUrl}/${r2Key}`;
    console.log(`✅ Uploaded: ${originalName} → ${r2Url}`);
    
    return {
      originalPath: `/${originalName}`,
      r2Url: r2Url,
      r2Key,
      size: fileBuffer.length,
      mimeType
    };
  } catch (error) {
    console.error(`❌ Failed to upload ${originalName}:`, error.message);
    throw error;
  }
}

/**
 * Main upload function
 */
async function uploadStaticAssets() {
  console.log('🚀 Starting static assets upload to R2...');
  console.log(`📁 Source directory: ${FRONTEND_PUBLIC_DIR}`);
  console.log(`🪣 R2 bucket: ${bucketName}`);
  console.log(`📂 R2 folder: ${R2_FOLDER}`);
  console.log(`🌐 Public URL: ${publicUrl}`);
  console.log('');

  // Check if source directory exists
  if (!fs.existsSync(FRONTEND_PUBLIC_DIR)) {
    console.error(`❌ Source directory not found: ${FRONTEND_PUBLIC_DIR}`);
    process.exit(1);
  }

  // Read all files from public directory
  const files = fs.readdirSync(FRONTEND_PUBLIC_DIR);
  const imageFiles = files.filter(file => 
    isImageFile(file) && !EXCLUDE_FILES.includes(file)
  );

  console.log(`📊 Found ${imageFiles.length} image files to upload:`);
  imageFiles.forEach(file => console.log(`   - ${file}`));
  console.log('');

  if (imageFiles.length === 0) {
    console.log('ℹ️  No image files found to upload.');
    return;
  }

  const uploadResults = [];
  let successCount = 0;
  let errorCount = 0;

  // Upload each file
  for (const filename of imageFiles) {
    try {
      const filePath = path.join(FRONTEND_PUBLIC_DIR, filename);
      const result = await uploadFileToR2(filePath, filename);
      uploadResults.push(result);
      successCount++;
    } catch (error) {
      errorCount++;
      console.error(`❌ Failed to upload ${filename}`);
    }
  }

  // Generate mapping file
  const mapping = {
    r2BaseUrl: publicUrl,
    r2Folder: R2_FOLDER,
    uploadDate: new Date().toISOString(),
    totalFiles: imageFiles.length,
    successCount,
    errorCount,
    assets: uploadResults.reduce((acc, result) => {
      acc[result.originalPath] = result.r2Url;
      return acc;
    }, {})
  };

  fs.writeFileSync(MAPPING_FILE, JSON.stringify(mapping, null, 2));
  
  console.log('');
  console.log('📊 Upload Summary:');
  console.log(`   ✅ Successfully uploaded: ${successCount}`);
  console.log(`   ❌ Failed uploads: ${errorCount}`);
  console.log(`   📄 Mapping file created: ${MAPPING_FILE}`);
  console.log('');
  
  if (successCount > 0) {
    console.log('🎉 Static assets successfully uploaded to R2!');
    console.log('📝 Next steps:');
    console.log('   1. Update frontend code to use R2 URLs');
    console.log('   2. Test all pages to verify images load correctly');
    console.log('   3. Remove uploaded files from /public folder');
  }

  if (errorCount > 0) {
    console.log('⚠️  Some uploads failed. Please check the errors above.');
    process.exit(1);
  }
}

// Run the upload
uploadStaticAssets().catch(error => {
  console.error('💥 Upload process failed:', error);
  process.exit(1);
});
