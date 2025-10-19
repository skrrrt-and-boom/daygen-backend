#!/usr/bin/env node

/**
 * Migrate External URLs to R2
 * This script finds images with external URLs and uploads them to R2
 */

const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');
const fetch = require('node-fetch');
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

function isR2Url(url) {
  try {
    const urlObj = new URL(url);
    return (
      urlObj.hostname.includes('r2.dev') ||
      urlObj.hostname.includes('cloudflarestorage.com')
    );
  } catch {
    return false;
  }
}

function isBase64Url(url) {
  return url.startsWith('data:image/');
}

async function downloadImage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ImageMigration/1.0)',
      },
      timeout: 30000, // 30 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.buffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    return { buffer, contentType };
  } catch (error) {
    throw new Error(`Failed to download image: ${error.message}`);
  }
}

async function uploadToR2(buffer, contentType, fileName) {
  // Determine file extension
  const mimeToExt = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg', 
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
  };
  const extension = mimeToExt[contentType] || '.jpg';
  const key = `migrated-external/${randomUUID()}${extension}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000',
  });

  await s3Client.send(command);
  return `${publicUrl}/${key}`;
}

async function migrateExternalUrls() {
  console.log('🔄 Starting external URL migration to R2...\n');

  try {
    // Find all R2File records that are not base64 and not already R2 URLs
    const files = await prisma.r2File.findMany({
      where: {
        fileUrl: {
          not: {
            startsWith: 'data:image/'
          }
        }
      }
    });

    console.log(`📊 Found ${files.length} files to check`);

    // Filter out files that are already R2 URLs
    const externalFiles = files.filter(file => !isR2Url(file.fileUrl));
    
    console.log(`📊 Found ${externalFiles.length} external URLs to migrate`);

    if (externalFiles.length === 0) {
      console.log('✅ No external URLs found to migrate');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const file of externalFiles) {
      try {
        console.log(`📤 Migrating: ${file.fileName} from ${file.fileUrl}`);
        
        // Download the image
        const { buffer, contentType } = await downloadImage(file.fileUrl);
        
        // Upload to R2
        const r2Url = await uploadToR2(buffer, contentType, file.fileName);
        
        // Update the file record with the new R2 URL
        await prisma.r2File.update({
          where: { id: file.id },
          data: {
            fileUrl: r2Url,
            mimeType: contentType,
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
    console.log(`   📊 Total processed: ${externalFiles.length}`);

    if (successCount > 0) {
      console.log('\n🎉 External URL migration completed!');
      console.log('   All external images are now stored in R2.');
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
migrateExternalUrls().catch(console.error);
