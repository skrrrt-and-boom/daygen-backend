const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');
const axios = require('axios');
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
  disableHostPrefix: true,
});

const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;

// Check if R2 is configured
function checkR2Configuration() {
  const requiredEnvVars = [
    'CLOUDFLARE_R2_ACCOUNT_ID',
    'CLOUDFLARE_R2_ACCESS_KEY_ID',
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'CLOUDFLARE_R2_BUCKET_NAME',
    'CLOUDFLARE_R2_PUBLIC_URL'
  ];

  const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    console.error('Please ensure all R2 environment variables are set in your .env file');
    process.exit(1);
  }
}

// Check if URL is already an R2 URL
function isR2Url(url) {
  return url && url.startsWith(publicUrl);
}

// Check if URL is base64 data URL
function isBase64Url(url) {
  return url && url.startsWith('data:image/');
}

// Get file extension from mime type
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

// Upload base64 data to R2
async function uploadBase64ToR2(base64DataUrl, fileName) {
  const base64Match = base64DataUrl.match(/^data:([^;,]+);base64,(.*)$/);
  if (!base64Match) {
    throw new Error('Invalid base64 data URL format');
  }

  const [, mimeType, base64Data] = base64Match;
  const buffer = Buffer.from(base64Data, 'base64');
  const fileExtension = getFileExtensionFromMimeType(mimeType);
  const key = `generated-images/${randomUUID()}${fileExtension}`;

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

// Download and upload external URL to R2
async function uploadExternalUrlToR2(url, fileName) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DaygenBot/1.0)',
      },
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    const fileExtension = getFileExtensionFromMimeType(contentType);
    const key = `generated-images/${randomUUID()}${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: response.data,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000',
    });

    await s3Client.send(command);
    return `${publicUrl}/${key}`;
  } catch (error) {
    throw new Error(`Failed to download external URL: ${error.message}`);
  }
}

// Update R2File records
async function updateR2FileUrls() {
  console.log('🔄 Updating R2File records...\n');
  
  // Find R2File records with non-R2 URLs
  const r2Files = await prisma.r2File.findMany({
    where: {
      OR: [
        { fileUrl: { startsWith: 'data:image/' } },
        { 
          fileUrl: { 
            not: { startsWith: publicUrl }
          }
        }
      ]
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

  console.log(`📊 Found ${r2Files.length} R2File records with non-R2 URLs`);

  if (r2Files.length === 0) {
    console.log('✅ No R2File records need updating');
    return { success: 0, failed: 0, skipped: 0 };
  }

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const errors = [];

  for (const r2File of r2Files) {
    try {
      console.log(`📤 Processing R2File: ${r2File.fileName} (${r2File.id})`);
      
      let newUrl;
      
      if (isBase64Url(r2File.fileUrl)) {
        console.log('   📋 Converting base64 to R2...');
        newUrl = await uploadBase64ToR2(r2File.fileUrl, r2File.fileName);
      } else if (!isR2Url(r2File.fileUrl)) {
        console.log('   📋 Downloading external URL to R2...');
        newUrl = await uploadExternalUrlToR2(r2File.fileUrl, r2File.fileName);
      } else {
        console.log('   ⏭️  Skipping - already R2 URL');
        skippedCount++;
        continue;
      }

      // Update the record
      await prisma.r2File.update({
        where: { id: r2File.id },
        data: {
          fileUrl: newUrl,
          updatedAt: new Date(),
        }
      });

      console.log(`   ✅ Updated: ${r2File.fileUrl} -> ${newUrl}`);
      successCount++;

    } catch (error) {
      console.error(`   ❌ Failed to process ${r2File.fileName}: ${error.message}`);
      failedCount++;
      errors.push({ 
        type: 'R2File', 
        id: r2File.id, 
        fileName: r2File.fileName, 
        error: error.message 
      });
    }
  }

  console.log(`\n📈 R2File Update Summary:`);
  console.log(`   ✅ Successfully updated: ${successCount}`);
  console.log(`   ❌ Failed: ${failedCount}`);
  console.log(`   ⏭️  Skipped: ${skippedCount}`);
  console.log(`   📊 Total processed: ${r2Files.length}`);

  return { success: successCount, failed: failedCount, skipped: skippedCount, errors };
}

// Update Job records
async function updateJobUrls() {
  console.log('\n🔄 Updating Job records...\n');
  
  // Find Job records with non-R2 URLs in resultUrl
  const jobs = await prisma.job.findMany({
    where: {
      resultUrl: {
        not: null,
        not: { startsWith: publicUrl }
      }
    },
    select: {
      id: true,
      resultUrl: true,
      type: true,
      status: true,
      userId: true,
      createdAt: true
    }
  });

  console.log(`📊 Found ${jobs.length} Job records with non-R2 resultUrl`);

  if (jobs.length === 0) {
    console.log('✅ No Job records need updating');
    return { success: 0, failed: 0, skipped: 0 };
  }

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const errors = [];

  for (const job of jobs) {
    try {
      console.log(`📤 Processing Job: ${job.id} (${job.type})`);
      
      let newUrl;
      
      if (isBase64Url(job.resultUrl)) {
        console.log('   📋 Converting base64 to R2...');
        newUrl = await uploadBase64ToR2(job.resultUrl, `job-${job.id}.png`);
      } else if (!isR2Url(job.resultUrl)) {
        console.log('   📋 Downloading external URL to R2...');
        newUrl = await uploadExternalUrlToR2(job.resultUrl, `job-${job.id}.png`);
      } else {
        console.log('   ⏭️  Skipping - already R2 URL');
        skippedCount++;
        continue;
      }

      // Update the record
      await prisma.job.update({
        where: { id: job.id },
        data: {
          resultUrl: newUrl,
          updatedAt: new Date(),
        }
      });

      console.log(`   ✅ Updated: ${job.resultUrl} -> ${newUrl}`);
      successCount++;

    } catch (error) {
      console.error(`   ❌ Failed to process Job ${job.id}: ${error.message}`);
      failedCount++;
      errors.push({ 
        type: 'Job', 
        id: job.id, 
        resultUrl: job.resultUrl, 
        error: error.message 
      });
    }
  }

  console.log(`\n📈 Job Update Summary:`);
  console.log(`   ✅ Successfully updated: ${successCount}`);
  console.log(`   ❌ Failed: ${failedCount}`);
  console.log(`   ⏭️  Skipped: ${skippedCount}`);
  console.log(`   📊 Total processed: ${jobs.length}`);

  return { success: successCount, failed: failedCount, skipped: skippedCount, errors };
}

async function updateDbUrlsToR2() {
  console.log('🔄 Starting database URL migration to R2...\n');
  
  checkR2Configuration();
  
  try {
    // Update R2File records
    const r2FileResults = await updateR2FileUrls();
    
    // Update Job records
    const jobResults = await updateJobUrls();
    
    // Overall summary
    const totalSuccess = r2FileResults.success + jobResults.success;
    const totalFailed = r2FileResults.failed + jobResults.failed;
    const totalSkipped = r2FileResults.skipped + jobResults.skipped;
    const allErrors = [...(r2FileResults.errors || []), ...(jobResults.errors || [])];
    
    console.log(`\n🎯 Overall Migration Summary:`);
    console.log(`   ✅ Successfully updated: ${totalSuccess}`);
    console.log(`   ❌ Failed: ${totalFailed}`);
    console.log(`   ⏭️  Skipped: ${totalSkipped}`);
    console.log(`   📊 Total processed: ${totalSuccess + totalFailed + totalSkipped}`);
    
    if (allErrors.length > 0) {
      console.log('\n❌ Errors encountered:');
      allErrors.forEach(({ type, id, fileName, resultUrl, error }) => {
        const identifier = fileName || resultUrl || id;
        console.log(`   - ${type} ${identifier}: ${error}`);
      });
    }
    
    if (totalSuccess > 0) {
      console.log('\n🎉 Migration completed!');
      console.log('   All database URLs have been updated to use R2 public URLs');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
if (require.main === module) {
  updateDbUrlsToR2().catch(console.error);
}

module.exports = { updateDbUrlsToR2 };
