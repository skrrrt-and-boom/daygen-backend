const { PrismaClient } = require('@prisma/client');
const { S3Client, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');
const http = require('http');

// Load environment variables
require('dotenv').config();

const prisma = new PrismaClient();

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'daygen-assets';
const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL;

// Initialize S3 client for R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
  useAccelerateEndpoint: false,
  disableHostPrefix: true,
});

console.log('🚀 Starting Complete Image Migration...\n');
console.log('Configuration:');
console.log('- Bucket:', R2_BUCKET_NAME);
console.log('- Public URL:', R2_PUBLIC_URL);
console.log('- Target Directory: generated-images/\n');

async function migrateAllImages() {
  try {
    // Step 1: Get all images from database
    console.log('📊 Step 1: Analyzing database images...');
    const allImages = await prisma.r2File.findMany({
      where: {
        deletedAt: null
      },
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        id: true,
        fileName: true,
        fileUrl: true,
        fileSize: true,
        mimeType: true,
        prompt: true,
        model: true,
        createdAt: true,
        ownerAuthId: true
      }
    });

    console.log(`Found ${allImages.length} images in database`);

    // Categorize images
    const r2Images = allImages.filter(img => img.fileUrl.includes('pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev'));
    const base64Images = allImages.filter(img => img.fileUrl.startsWith('data:image/'));
    const externalImages = allImages.filter(img => 
      !img.fileUrl.includes('pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev') && 
      !img.fileUrl.startsWith('data:image/')
    );

    console.log(`- R2 URLs: ${r2Images.length}`);
    console.log(`- Base64: ${base64Images.length}`);
    console.log(`- External: ${externalImages.length}`);

    // Step 2: Migrate base64 images
    if (base64Images.length > 0) {
      console.log(`\n📤 Step 2: Migrating ${base64Images.length} base64 images to R2...`);
      await migrateBase64Images(base64Images);
    }

    // Step 3: Reorganize R2 bucket structure
    console.log('\n📁 Step 3: Reorganizing R2 bucket structure...');
    await reorganizeBucketStructure();

    // Step 4: Update database URLs for moved files
    console.log('\n🔄 Step 4: Updating database URLs...');
    await updateDatabaseUrls();

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📋 Summary:');
    console.log('- Base64 images migrated to R2');
    console.log('- All files moved to generated-images/ directory');
    console.log('- Database URLs updated');
    console.log('- Old directories cleaned up');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

async function migrateBase64Images(base64Images) {
  const results = [];
  const errors = [];

  for (let i = 0; i < base64Images.length; i++) {
    const image = base64Images[i];
    console.log(`  Migrating ${i + 1}/${base64Images.length}: ${image.fileName}`);

    try {
      // Extract base64 data and mime type
      const base64Match = image.fileUrl.match(/^data:([^;,]+);base64,(.*)$/);
      if (!base64Match) {
        errors.push({
          id: image.id,
          fileName: image.fileName,
          error: 'Invalid base64 data URL format'
        });
        continue;
      }

      const [, mimeType, base64Data] = base64Match;
      const finalMimeType = image.mimeType || mimeType || 'image/png';
      const buffer = Buffer.from(base64Data, 'base64');

      // Generate new filename
      const fileExtension = getFileExtensionFromMimeType(finalMimeType);
      const newFileName = `generated-images/${image.id}${fileExtension}`;

      // Upload to R2
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: newFileName,
        Body: buffer,
        ContentType: finalMimeType,
        CacheControl: 'public, max-age=31536000',
      });

      await s3Client.send(command);

      // Update database
      const newUrl = `${R2_PUBLIC_URL}/${newFileName}`;
      await prisma.r2File.update({
        where: { id: image.id },
        data: {
          fileUrl: newUrl,
          fileName: `${image.id}${fileExtension}`,
          fileSize: buffer.length,
          mimeType: finalMimeType,
          updatedAt: new Date(),
        },
      });

      results.push({
        id: image.id,
        oldUrl: image.fileUrl.substring(0, 50) + '...',
        newUrl: newUrl,
        success: true
      });

    } catch (error) {
      console.error(`    ❌ Failed: ${error.message}`);
      errors.push({
        id: image.id,
        fileName: image.fileName,
        error: error.message
      });
    }
  }

  console.log(`\n  📊 Base64 Migration Results:`);
  console.log(`  ✅ Successful: ${results.length}`);
  console.log(`  ❌ Failed: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\n  ❌ Errors:');
    errors.forEach(err => {
      console.log(`    - ${err.fileName}: ${err.error}`);
    });
  }
}

async function reorganizeBucketStructure() {
  try {
    // List all objects in the bucket
    const listCommand = new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
    });

    const response = await s3Client.send(listCommand);
    const objects = response.Contents || [];

    console.log(`  Found ${objects.length} objects in bucket`);

    // Group objects by current directory
    const objectsByDir = {};
    objects.forEach(obj => {
      const key = obj.Key;
      const dir = key.includes('/') ? key.split('/')[0] : 'root';
      if (!objectsByDir[dir]) {
        objectsByDir[dir] = [];
      }
      objectsByDir[dir].push(key);
    });

    console.log(`  Current directories: ${Object.keys(objectsByDir).join(', ')}`);

    // Move files from other directories to generated-images/
    for (const [dir, files] of Object.entries(objectsByDir)) {
      if (dir === 'generated-images') {
        console.log(`  ✅ ${dir}/ already in correct location (${files.length} files)`);
        continue;
      }

      console.log(`  📁 Moving ${files.length} files from ${dir}/ to generated-images/`);

      for (const fileKey of files) {
        try {
          const fileName = fileKey.split('/').pop();
          const newKey = `generated-images/${fileName}`;

          // Copy to new location
          const copyCommand = new CopyObjectCommand({
            Bucket: R2_BUCKET_NAME,
            CopySource: `${R2_BUCKET_NAME}/${fileKey}`,
            Key: newKey,
          });

          await s3Client.send(copyCommand);

          // Delete old file
          const deleteCommand = new DeleteObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: fileKey,
          });

          await s3Client.send(deleteCommand);

          console.log(`    ✅ Moved: ${fileKey} → ${newKey}`);

        } catch (error) {
          console.error(`    ❌ Failed to move ${fileKey}: ${error.message}`);
        }
      }
    }

  } catch (error) {
    console.error('  ❌ Failed to reorganize bucket:', error.message);
  }
}

async function updateDatabaseUrls() {
  try {
    // Get all R2 images that might need URL updates
    const r2Images = await prisma.r2File.findMany({
      where: {
        deletedAt: null,
        fileUrl: {
          contains: 'pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev'
        }
      },
      select: {
        id: true,
        fileUrl: true,
        fileName: true
      }
    });

    let updatedCount = 0;

    for (const image of r2Images) {
      // Check if URL needs updating (not in generated-images/)
      if (!image.fileUrl.includes('/generated-images/')) {
        try {
          // Extract filename from current URL
          const urlParts = image.fileUrl.split('/');
          const fileName = urlParts[urlParts.length - 1];
          
          // Create new URL
          const newUrl = `${R2_PUBLIC_URL}/generated-images/${fileName}`;

          // Update database
          await prisma.r2File.update({
            where: { id: image.id },
            data: {
              fileUrl: newUrl,
              updatedAt: new Date(),
            },
          });

          console.log(`  ✅ Updated URL: ${image.fileName}`);
          updatedCount++;

        } catch (error) {
          console.error(`  ❌ Failed to update ${image.fileName}: ${error.message}`);
        }
      }
    }

    console.log(`  📊 Updated ${updatedCount} database URLs`);

  } catch (error) {
    console.error('  ❌ Failed to update database URLs:', error.message);
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

// Run the migration
migrateAllImages();
