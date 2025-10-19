#!/usr/bin/env node

/**
 * Database cleanup script to remove base64 data from database records
 * This script finds and removes base64 image data from Job.resultUrl and UsageEvent.metadata fields
 */

const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function cleanupBase64FromDatabase() {
  console.log('🧹 Starting database cleanup to remove base64 data...\n');

  try {
    // 1. Clean up Job.resultUrl field
    console.log('1️⃣ Cleaning up Job.resultUrl field...');
    
    const jobsWithBase64 = await prisma.job.findMany({
      where: {
        resultUrl: {
          startsWith: 'data:image/'
        }
      },
      select: {
        id: true,
        resultUrl: true,
        createdAt: true,
        status: true
      }
    });

    console.log(`Found ${jobsWithBase64.length} jobs with base64 data in resultUrl`);

    if (jobsWithBase64.length > 0) {
      // Update these jobs to have null resultUrl (they failed to upload to R2)
      const updateResult = await prisma.job.updateMany({
        where: {
          resultUrl: {
            startsWith: 'data:image/'
          }
        },
        data: {
          resultUrl: null,
          status: 'FAILED',
          error: 'Job failed - R2 upload not configured or failed. Base64 data removed for database optimization.'
        }
      });

      console.log(`✅ Updated ${updateResult.count} jobs - set resultUrl to null and status to FAILED`);
    }

    // 2. Clean up UsageEvent.metadata field
    console.log('\n2️⃣ Cleaning up UsageEvent.metadata field...');
    
    const usageEventsWithBase64 = await prisma.usageEvent.findMany({
      where: {
        metadata: {
          path: [],
          string_contains: 'data:image/'
        }
      },
      select: {
        id: true,
        metadata: true,
        createdAt: true
      }
    });

    console.log(`Found ${usageEventsWithBase64.length} usage events with base64 data in metadata`);

    if (usageEventsWithBase64.length > 0) {
      // Clean up metadata by removing base64 data
      let cleanedCount = 0;
      
      for (const event of usageEventsWithBase64) {
        if (event.metadata && typeof event.metadata === 'object') {
          const cleanedMetadata = cleanMetadataFromBase64(event.metadata);
          
          if (JSON.stringify(cleanedMetadata) !== JSON.stringify(event.metadata)) {
            await prisma.usageEvent.update({
              where: { id: event.id },
              data: { metadata: cleanedMetadata }
            });
            cleanedCount++;
          }
        }
      }

      console.log(`✅ Cleaned ${cleanedCount} usage events - removed base64 data from metadata`);
    }

    // 3. Check for any other potential base64 data
    console.log('\n3️⃣ Checking for other potential base64 data...');
    
    // Check if any R2File records have base64 URLs (this shouldn't happen but let's check)
    const r2FilesWithBase64 = await prisma.r2File.findMany({
      where: {
        fileUrl: {
          startsWith: 'data:image/'
        }
      },
      select: {
        id: true,
        fileUrl: true,
        fileName: true
      }
    });

    if (r2FilesWithBase64.length > 0) {
      console.log(`⚠️  Found ${r2FilesWithBase64.length} R2File records with base64 URLs (this is unexpected)`);
      console.log('These records should be investigated and migrated to R2:');
      r2FilesWithBase64.forEach(file => {
        console.log(`  - ${file.fileName}: ${file.fileUrl.substring(0, 50)}...`);
      });
    } else {
      console.log('✅ No R2File records with base64 URLs found');
    }

    // 4. Summary
    console.log('\n📊 Cleanup Summary:');
    console.log(`- Jobs with base64 resultUrl: ${jobsWithBase64.length} (set to null and marked as FAILED)`);
    console.log(`- Usage events with base64 metadata: ${usageEventsWithBase64.length} (cleaned)`);
    console.log(`- R2File records with base64 URLs: ${r2FilesWithBase64.length} (investigation needed)`);

    console.log('\n✅ Database cleanup completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('1. Ensure R2 is properly configured');
    console.log('2. Test image generation to verify R2 URLs are being stored');
    console.log('3. Consider re-running failed jobs if needed');

  } catch (error) {
    console.error('❌ Database cleanup failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Recursively clean base64 data from metadata objects
 */
function cleanMetadataFromBase64(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(cleanMetadataFromBase64);
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.startsWith('data:image/')) {
      // Replace base64 data with a placeholder
      cleaned[key] = '[BASE64_DATA_REMOVED]';
    } else if (typeof value === 'object' && value !== null) {
      cleaned[key] = cleanMetadataFromBase64(value);
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

// Run cleanup if this script is executed directly
if (require.main === module) {
  cleanupBase64FromDatabase()
    .then(() => {
      console.log('\n🎉 Cleanup completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = {
  cleanupBase64FromDatabase,
  cleanMetadataFromBase64,
};

