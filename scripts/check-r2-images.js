const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkR2Images() {
  try {
    console.log('🔍 Checking recent R2 images in database...\n');
    
    const images = await prisma.r2File.findMany({
      where: {
        deletedAt: null
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5,
      select: {
        id: true,
        fileName: true,
        fileUrl: true,
        createdAt: true
      }
    });

    if (images.length === 0) {
      console.log('📭 No images found in database.');
      console.log('💡 This is normal if you haven\'t uploaded any images yet.');
      return;
    }

    console.log(`📊 Found ${images.length} recent images:\n`);
    
    images.forEach((image, index) => {
      console.log(`${index + 1}. ${image.fileName}`);
      console.log(`   ID: ${image.id}`);
      console.log(`   URL: ${image.fileUrl}`);
      console.log(`   Created: ${image.createdAt.toISOString()}`);
      
      // Check if URL looks correct
      const isR2Url = image.fileUrl.includes('pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev');
      const isBase64 = image.fileUrl.startsWith('data:image/');
      const isExternal = !isR2Url && !isBase64;
      
      if (isR2Url) {
        console.log(`   Status: ✅ R2 URL (correct)`);
      } else if (isBase64) {
        console.log(`   Status: ⚠️  Base64 (needs migration)`);
      } else if (isExternal) {
        console.log(`   Status: ❌ External URL (may not work)`);
      } else {
        console.log(`   Status: ❓ Unknown format`);
      }
      console.log('');
    });

    // Summary
    const r2Count = images.filter(img => img.fileUrl.includes('pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev')).length;
    const base64Count = images.filter(img => img.fileUrl.startsWith('data:image/')).length;
    const externalCount = images.filter(img => !img.fileUrl.includes('pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev') && !img.fileUrl.startsWith('data:image/')).length;

    console.log('📈 Summary:');
    console.log(`   ✅ R2 URLs: ${r2Count}`);
    console.log(`   ⚠️  Base64: ${base64Count}`);
    console.log(`   ❌ External: ${externalCount}`);

    if (r2Count > 0) {
      console.log('\n🎉 Great! You have images with correct R2 URLs.');
      console.log('   These should display properly in your gallery.');
    }

    if (base64Count > 0) {
      console.log('\n💡 You have base64 images that could be migrated to R2.');
      console.log('   Use the migration endpoint: POST /api/upload/migrate-base64-batch');
    }

    if (externalCount > 0) {
      console.log('\n⚠️  You have external URLs that may not work reliably.');
      console.log('   Consider migrating these to R2 for better reliability.');
    }

  } catch (error) {
    console.error('❌ Error checking database:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkR2Images();
