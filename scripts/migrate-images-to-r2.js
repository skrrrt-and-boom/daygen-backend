#!/usr/bin/env node

/**
 * Migrate Base64 Images to R2
 * This script finds images with base64 data URLs and uploads them to R2
 */

const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');
require('dotenv').config();

const prisma = new PrismaClient();

// Initialize R2 client
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
});

const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;

async function uploadBase64ToR2(base64DataUrl, fileName) {
  // Extract base64 data and MIME type
  const base64Match = base64DataUrl.match(/^data:([^;,]+);base64,(.*)$/);
  if (!base64Match) {
    throw new Error('Invalid base64 data URL format');
  }

  const [, mimeType, base64Data] = base64Match;
  const buffer = Buffer.from(base64Data, 'base64');

  // Determine file extension
  const mimeToExt = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg', 
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
  };
  const extension = mimeToExt[mimeType] || '.png';
  const key = `migrated-images/${randomUUID()}${extension}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: 'public, max-age=31536000',
  });

  await s3Client.send(command);
  return `${publicUrl}/${key}`;
}

async function migrateImages() {
  console.log('🔄 Starting image migration to R2...\n');

  try {
    // Find all R2File records that might have base64 URLs
    const files = await prisma.r2File.findMany({
      where: {
        fileUrl: {
          startsWith: 'data:image/'
        }
      }
    });

    console.log(`📊 Found ${files.length} files with base64 URLs to migrate`);

    if (files.length === 0) {
      console.log('✅ No base64 images found to migrate');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const file of files) {
      try {
        console.log(`📤 Migrating: ${file.fileName}`);
        
        const r2Url = await uploadBase64ToR2(file.fileUrl, file.fileName);
        
        // Update the file record with the new R2 URL
        await prisma.r2File.update({
          where: { id: file.id },
          data: {
            fileUrl: r2Url,
            updatedAt: new Date(),
          }
        });

        console.log(`✅ Migrated: ${file.fileName} -> ${r2Url}`);
        successCount++;

      } catch (error) {
        console.error(`❌ Failed to migrate ${file.fileName}: ${error.message}`);
        errorCount++;
      }
    }

    console.log(`\n📈 Migration Summary:`);
    console.log(`   ✅ Successfully migrated: ${successCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);
    console.log(`   📊 Total processed: ${files.length}`);

    if (successCount > 0) {
      console.log('\n🎉 Migration completed! Your images are now stored in R2.');
      console.log('   Images will load faster and be more reliable.');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Check if R2 is configured
function checkR2Configuration() {
  const requiredEnvVars = [
    'CLOUDFLARE_R2_ACCOUNT_ID',
    'CLOUDFLARE_R2_ACCESS_KEY_ID',
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'CLOUDFLARE_R2_BUCKET_NAME',
    'CLOUDFLARE_R2_PUBLIC_URL'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing R2 configuration. Please set up R2 first:');
    console.error('   Missing variables:', missingVars.join(', '));
    console.error('\nRun: npm run setup:r2');
    process.exit(1);
  }
}

// Run migration
checkR2Configuration();
migrateImages().catch(console.error);
