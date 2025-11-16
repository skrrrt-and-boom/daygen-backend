#!/usr/bin/env node

/**
 * Move Preset Images to Presets Subfolder
 * 
 * Moves preset images from website-assets/ to website-assets/presets/
 * in Cloudflare R2 bucket.
 */

const { S3Client, CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

// Load environment variables
require('dotenv').config();

// Configuration
const BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME?.trim() || 'daygen-assets';
const SOURCE_FOLDER = 'website-assets';
const TARGET_FOLDER = 'website-assets/presets';

// Preset files to move
const PRESET_FILES = [
  'black_suit_studio setup.png',
  'french_balcony.png',
  'boat_in_coastal_town.png',
  'brick_in_the_wall.png',
  'smoking_hot.png',
  'sun_and_sea.png',
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
 * Check if object exists
 */
async function objectExists(key) {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Copy object to new location
 */
async function copyObject(sourceKey, destinationKey) {
  const command = new CopyObjectCommand({
    Bucket: BUCKET_NAME,
    CopySource: `${BUCKET_NAME}/${sourceKey}`,
    Key: destinationKey,
  });
  
  await s3Client.send(command);
  return `${publicUrl}/${destinationKey}`;
}

/**
 * Delete object
 */
async function deleteObject(key) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  
  await s3Client.send(command);
}

/**
 * Move preset file from source to target folder
 */
async function movePresetFile(fileName) {
  const sourceKey = `${SOURCE_FOLDER}/${fileName}`;
  const targetKey = `${TARGET_FOLDER}/${fileName}`;
  
  try {
    // Check if source file exists
    const sourceExists = await objectExists(sourceKey);
    if (!sourceExists) {
      console.log(`⚠️  Source file not found: ${sourceKey}`);
      return { success: false, skipped: true, reason: 'Source not found' };
    }
    
    // Check if target already exists
    const targetExists = await objectExists(targetKey);
    if (targetExists) {
      console.log(`⚠️  Target file already exists: ${targetKey}`);
      console.log(`   Skipping move (file may have already been moved)`);
      return { success: false, skipped: true, reason: 'Target exists' };
    }
    
    // Copy to new location
    console.log(`📋 Copying: ${sourceKey} → ${targetKey}`);
    const newUrl = await copyObject(sourceKey, targetKey);
    
    // Delete old file
    console.log(`🗑️  Deleting: ${sourceKey}`);
    await deleteObject(sourceKey);
    
    console.log(`✅ Moved: ${fileName}`);
    console.log(`   → ${newUrl}`);
    
    return { success: true, newUrl };
  } catch (error) {
    console.error(`❌ Failed to move ${fileName}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Main function
 */
async function movePresets() {
  console.log('🚀 Starting preset images migration...');
  console.log(`🪣 R2 bucket: ${BUCKET_NAME}`);
  console.log(`📂 Source: ${SOURCE_FOLDER}/`);
  console.log(`📂 Target: ${TARGET_FOLDER}/`);
  console.log(`🌐 Public URL: ${publicUrl}`);
  console.log('');
  
  const results = [];
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  
  // Move each preset file
  for (const fileName of PRESET_FILES) {
    const result = await movePresetFile(fileName);
    results.push({ fileName, ...result });
    
    if (result.success) {
      successCount++;
    } else if (result.skipped) {
      skippedCount++;
    } else {
      errorCount++;
    }
    
    console.log('');
  }
  
  // Summary
  console.log('📊 Migration Summary:');
  console.log(`   ✅ Successfully moved: ${successCount}`);
  console.log(`   ⚠️  Skipped: ${skippedCount}`);
  console.log(`   ❌ Failed: ${errorCount}`);
  console.log('');
  
  if (successCount > 0) {
    console.log('🎉 Preset images successfully moved to presets/ subfolder!');
  }
  
  if (errorCount > 0) {
    console.log('⚠️  Some moves failed. Please check the errors above.');
    process.exit(1);
  }
  
  if (skippedCount > 0 && successCount === 0) {
    console.log('ℹ️  All files were skipped (may have already been moved).');
  }
}

// Run the migration
movePresets().catch(error => {
  console.error('💥 Migration process failed:', error);
  process.exit(1);
});

