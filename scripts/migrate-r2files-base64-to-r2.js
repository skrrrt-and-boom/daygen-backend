#!/usr/bin/env node

/**
 * Migration script to upload base64 data from R2File records to R2 storage
 * and update the fileUrl field with the R2 public URL
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
  forcePathStyle: true,
  useAccelerateEndpoint: false,
  disableHostPrefix: true,
});

const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;

async function migrateR2FilesBase64ToR2() {
  console.log('🔄 Starting migration of R2File base64 data to R2 storage...\n');

  // Check R2 configuration
  if (!bucketName || !publicUrl) {
    console.error('❌ R2 not configured - missing CLOUDFLARE_R2_BUCKET_NAME or CLOUDFLARE_R2_PUBLIC_URL');
    process.exit(1);
  }

  try {
    // Find R2File records with base64 URLs
    const r2FilesWithBase64 = await prisma.r2File.findMany({
      where: {
        fileUrl: {
          startsWith: 'data:image/'
        }
      },
      select: {
        id: true,
        fileUrl: true,
        fileName: true,
        mimeType: true,
        ownerAuthId: true,
        prompt: true,
        model: true,
        createdAt: true
      }
    });

    console.log(`Found ${r2FilesWithBase64.length} R2File records with base64 URLs`);

    if (r2FilesWithBase64.length === 0) {
      console.log('✅ No R2File records with base64 URLs found - nothing to migrate');
      return;
    }

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const r2File of r2FilesWithBase64) {
      try {
        console.log(`\n📤 Migrating ${r2File.fileName}...`);

        // Extract base64 data and mime type
        const base64Match = r2File.fileUrl.match(/^data:([^;,]+);base64,(.*)$/);
        if (!base64Match) {
          throw new Error('Invalid base64 data URL format');
        }

        const [, mimeType, base64Data] = base64Match;
        const finalMimeType = r2File.mimeType || mimeType || 'image/png';

        // Convert base64 to buffer
        const buffer = Buffer.from(base64Data, 'base64');

        // Generate new file name for R2
        const fileExtension = getFileExtensionFromMimeType(finalMimeType);
        const newFileName = `migrated-r2files/${randomUUID()}${fileExtension}`;

        // Upload to R2
        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: newFileName,
          Body: buffer,
          ContentType: finalMimeType,
          CacheControl: 'public, max-age=31536000',
        });

        await s3Client.send(command);

        // Generate R2 public URL
        const r2PublicUrl = `${publicUrl}/${newFileName}`;

        // Update R2File record with R2 URL
        await prisma.r2File.update({
          where: { id: r2File.id },
          data: {
            fileUrl: r2PublicUrl,
            mimeType: finalMimeType,
            updatedAt: new Date(),
          },
        });

        console.log(`✅ Migrated ${r2File.fileName} -> ${r2PublicUrl}`);
        successCount++;

      } catch (error) {
        console.error(`❌ Failed to migrate ${r2File.fileName}:`, error.message);
        errors.push({
          fileName: r2File.fileName,
          error: error.message,
        });
        errorCount++;
      }
    }

    // Summary
    console.log('\n📊 Migration Summary:');
    console.log(`- Total records: ${r2FilesWithBase64.length}`);
    console.log(`- Successfully migrated: ${successCount}`);
    console.log(`- Failed migrations: ${errorCount}`);

    if (errors.length > 0) {
      console.log('\n❌ Migration errors:');
      errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.fileName}: ${error.error}`);
      });
    }

    if (successCount > 0) {
      console.log('\n✅ Migration completed successfully!');
      console.log('All base64 data has been uploaded to R2 and database records updated with public URLs.');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

function getFileExtensionFromMimeType(mimeType) {
  const mimeToExt = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
  };
  return mimeToExt[mimeType] || '.png';
}

// Run migration if this script is executed directly
if (require.main === module) {
  migrateR2FilesBase64ToR2()
    .then(() => {
      console.log('\n🎉 Migration completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

module.exports = {
  migrateR2FilesBase64ToR2,
};

