const { PrismaClient } = require('@prisma/client');
const https = require('https');

// Load environment variables
require('dotenv').config();

const prisma = new PrismaClient();

const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL;

console.log('🔧 Fixing Old R2 URLs...\n');
console.log('Target Public URL:', R2_PUBLIC_URL);

async function fixOldR2Urls() {
  try {
    // Find all images with old R2 URLs
    const oldR2Images = await prisma.r2File.findMany({
      where: {
        fileUrl: {
          contains: '205ebd867bad50a18d438fa71fcfcb09.r2.cloudflarestorage.com'
        }
      },
      select: {
        id: true,
        fileName: true,
        fileUrl: true,
        mimeType: true,
        deletedAt: true
      }
    });

    console.log(`Found ${oldR2Images.length} images with old R2 URLs`);

    if (oldR2Images.length === 0) {
      console.log('✅ No old R2 URLs found to fix');
      return;
    }

    // Process each image
    let fixedCount = 0;
    let errorCount = 0;

    for (const image of oldR2Images) {
      try {
        console.log(`\n🔍 Processing: ${image.fileName}`);
        console.log(`   Current URL: ${image.fileUrl}`);
        console.log(`   Status: ${image.deletedAt ? 'Deleted' : 'Active'}`);

        // Extract the file path from the old URL
        const oldUrl = new URL(image.fileUrl);
        const oldPath = oldUrl.pathname.substring(1); // Remove leading slash
        
        // Create new URL with the correct public endpoint
        const newUrl = `${R2_PUBLIC_URL}/${oldPath}`;
        
        console.log(`   New URL: ${newUrl}`);

        // Test if the new URL is accessible
        const isAccessible = await testUrlAccess(newUrl);
        
        if (isAccessible) {
          // Update the database with the new URL
          await prisma.r2File.update({
            where: { id: image.id },
            data: {
              fileUrl: newUrl,
              updatedAt: new Date(),
            },
          });

          console.log(`   ✅ Updated successfully`);
          fixedCount++;
        } else {
          console.log(`   ❌ New URL not accessible - file may not exist`);
          errorCount++;
        }

      } catch (error) {
        console.error(`   ❌ Error processing ${image.fileName}: ${error.message}`);
        errorCount++;
      }
    }

    console.log(`\n📊 Fix Results:`);
    console.log(`✅ Successfully fixed: ${fixedCount}`);
    console.log(`❌ Failed: ${errorCount}`);

    // Show final status
    console.log(`\n🔍 Verifying remaining old URLs...`);
    const remainingOldUrls = await prisma.r2File.findMany({
      where: {
        fileUrl: {
          contains: '205ebd867bad50a18d438fa71fcfcb09.r2.cloudflarestorage.com'
        }
      },
      select: {
        id: true,
        fileName: true,
        fileUrl: true
      }
    });

    if (remainingOldUrls.length === 0) {
      console.log('✅ All old R2 URLs have been fixed!');
    } else {
      console.log(`⚠️  ${remainingOldUrls.length} URLs still need attention:`);
      remainingOldUrls.forEach(img => {
        console.log(`   - ${img.fileName}: ${img.fileUrl}`);
      });
    }

  } catch (error) {
    console.error('\n❌ Error fixing URLs:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

// Helper function to test URL accessibility
function testUrlAccess(url) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(url, (res) => {
      if (res.statusCode === 200) {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    req.on('error', () => {
      resolve(false);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Run the fix
fixOldR2Urls();
