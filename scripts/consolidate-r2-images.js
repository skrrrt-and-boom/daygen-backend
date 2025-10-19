const { PrismaClient } = require('@prisma/client');
const { S3Client, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
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

// List all objects with given prefix
async function listObjectsWithPrefix(prefix) {
  const objects = [];
  let continuationToken;
  
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    
    const response = await s3Client.send(command);
    if (response.Contents) {
      objects.push(...response.Contents);
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  return objects;
}

// Copy object to new location
async function copyObject(sourceKey, destinationKey) {
  const command = new CopyObjectCommand({
    Bucket: bucketName,
    CopySource: `${bucketName}/${sourceKey}`,
    Key: destinationKey,
  });
  
  await s3Client.send(command);
  return `${publicUrl}/${destinationKey}`;
}

// Delete object
async function deleteObject(key) {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });
  
  await s3Client.send(command);
}

// Update R2File record with new URL
async function updateR2FileUrl(oldUrl, newUrl) {
  const result = await prisma.r2File.updateMany({
    where: {
      fileUrl: oldUrl
    },
    data: {
      fileUrl: newUrl,
      updatedAt: new Date(),
    }
  });
  
  return result.count;
}

// Update Job record with new URL
async function updateJobResultUrl(oldUrl, newUrl) {
  const result = await prisma.job.updateMany({
    where: {
      resultUrl: oldUrl
    },
    data: {
      resultUrl: newUrl,
      updatedAt: new Date(),
    }
  });
  
  return result.count;
}

async function consolidateR2Images() {
  console.log('🔄 Starting R2 image consolidation...\n');
  
  checkR2Configuration();
  
  try {
    // List all objects in migrated-external/ and migrated-images/
    console.log('📋 Listing objects to consolidate...');
    const migratedExternalObjects = await listObjectsWithPrefix('migrated-external/');
    const migratedImagesObjects = await listObjectsWithPrefix('migrated-images/');
    
    const totalObjects = migratedExternalObjects.length + migratedImagesObjects.length;
    console.log(`📊 Found ${migratedExternalObjects.length} objects in migrated-external/`);
    console.log(`📊 Found ${migratedImagesObjects.length} objects in migrated-images/`);
    console.log(`📊 Total objects to consolidate: ${totalObjects}\n`);
    
    if (totalObjects === 0) {
      console.log('✅ No objects found to consolidate');
      return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Process migrated-external/ objects
    console.log('📤 Processing migrated-external/ objects...');
    for (const obj of migratedExternalObjects) {
      try {
        const sourceKey = obj.Key;
        const fileExtension = getFileExtensionFromMimeType(obj.ContentType || 'image/png');
        const newKey = `generated-images/${randomUUID()}${fileExtension}`;
        
        console.log(`   📋 Copying: ${sourceKey} -> ${newKey}`);
        
        // Copy object to new location
        const newUrl = await copyObject(sourceKey, newKey);
        
        // Update database records
        const r2FileUpdates = await updateR2FileUrl(`${publicUrl}/${sourceKey}`, newUrl);
        const jobUpdates = await updateJobResultUrl(`${publicUrl}/${sourceKey}`, newUrl);
        
        console.log(`   ✅ Copied and updated ${r2FileUpdates} R2File records, ${jobUpdates} Job records`);
        
        successCount++;
      } catch (error) {
        console.error(`   ❌ Failed to process ${obj.Key}: ${error.message}`);
        errorCount++;
        errors.push({ object: obj.Key, error: error.message });
      }
    }
    
    // Process migrated-images/ objects
    console.log('\n📤 Processing migrated-images/ objects...');
    for (const obj of migratedImagesObjects) {
      try {
        const sourceKey = obj.Key;
        const fileExtension = getFileExtensionFromMimeType(obj.ContentType || 'image/png');
        const newKey = `generated-images/${randomUUID()}${fileExtension}`;
        
        console.log(`   📋 Copying: ${sourceKey} -> ${newKey}`);
        
        // Copy object to new location
        const newUrl = await copyObject(sourceKey, newKey);
        
        // Update database records
        const r2FileUpdates = await updateR2FileUrl(`${publicUrl}/${sourceKey}`, newUrl);
        const jobUpdates = await updateJobResultUrl(`${publicUrl}/${sourceKey}`, newUrl);
        
        console.log(`   ✅ Copied and updated ${r2FileUpdates} R2File records, ${jobUpdates} Job records`);
        
        successCount++;
      } catch (error) {
        console.error(`   ❌ Failed to process ${obj.Key}: ${error.message}`);
        errorCount++;
        errors.push({ object: obj.Key, error: error.message });
      }
    }
    
    console.log(`\n📈 Consolidation Summary:`);
    console.log(`   ✅ Successfully processed: ${successCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);
    console.log(`   📊 Total objects: ${totalObjects}`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach(({ object, error }) => {
        console.log(`   - ${object}: ${error}`);
      });
    }
    
    if (successCount > 0) {
      console.log('\n🎉 Consolidation completed!');
      console.log('   All images are now in the generated-images/ folder');
      console.log('   Database records have been updated with new URLs');
      
      // Ask about cleanup
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      rl.question('\n🗑️  Do you want to delete the old objects from R2? (y/N): ', async (answer) => {
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          console.log('\n🗑️  Cleaning up old objects...');
          
          let deletedCount = 0;
          for (const obj of [...migratedExternalObjects, ...migratedImagesObjects]) {
            try {
              await deleteObject(obj.Key);
              deletedCount++;
              console.log(`   🗑️  Deleted: ${obj.Key}`);
            } catch (error) {
              console.error(`   ❌ Failed to delete ${obj.Key}: ${error.message}`);
            }
          }
          
          console.log(`\n✅ Cleanup completed! Deleted ${deletedCount} old objects`);
        } else {
          console.log('\nℹ️  Old objects kept for safety. You can delete them manually later.');
        }
        
        rl.close();
        await prisma.$disconnect();
      });
    } else {
      await prisma.$disconnect();
    }
    
  } catch (error) {
    console.error('❌ Consolidation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the consolidation
if (require.main === module) {
  consolidateR2Images().catch(console.error);
}

module.exports = { consolidateR2Images };
