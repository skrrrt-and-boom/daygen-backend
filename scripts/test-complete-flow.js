const { PrismaClient } = require('@prisma/client');
const { R2Service } = require('../dist/upload/r2.service');

const prisma = new PrismaClient();

async function testCompleteFlow() {
  console.log('🧪 Testing Complete R2 Flow\n');
  
  try {
    // Test 1: Check R2 Service Configuration
    console.log('1️⃣ Testing R2 Service Configuration...');
    const r2Service = new R2Service();
    
    if (r2Service.isConfigured()) {
      console.log('✅ R2 Service is properly configured');
    } else {
      console.log('❌ R2 Service is not configured');
      console.log('Missing environment variables');
      return;
    }

    // Test 2: Check Database for R2 Files
    console.log('\n2️⃣ Checking R2 Files in Database...');
    const r2Files = await prisma.r2File.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    console.log(`Found ${r2Files.length} active R2 files:`);
    
    r2Files.forEach((file, index) => {
      console.log(`  ${index + 1}. ${file.id}`);
      console.log(`     URL: ${file.fileUrl.substring(0, 80)}...`);
      console.log(`     Model: ${file.model || 'Unknown'}`);
      console.log(`     Created: ${file.createdAt.toISOString()}`);
      
      // Check URL format
      if (file.fileUrl.startsWith('https://pub-')) {
        console.log('     ✅ Proper R2 URL format');
      } else if (file.fileUrl.startsWith('data:')) {
        console.log('     ⚠️  Base64 data URL (should be migrated to R2)');
      } else if (file.fileUrl.startsWith('https://')) {
        console.log('     ⚠️  External URL (may cause 403 errors)');
      } else {
        console.log('     ❓ Unknown URL format');
      }
      console.log('');
    });

    // Test 3: Check for problematic URLs
    console.log('3️⃣ Checking for Problematic URLs...');
    const problematicFiles = await prisma.r2File.findMany({
      where: {
        OR: [
          { fileUrl: { startsWith: 'https://delivery-eu4.bfl.ai' } },
          { fileUrl: { startsWith: 'https://storage.cdn-luma.com' } },
        ],
        deletedAt: null
      }
    });

    if (problematicFiles.length === 0) {
      console.log('✅ No problematic URLs found');
    } else {
      console.log(`⚠️  Found ${problematicFiles.length} files with problematic URLs`);
      console.log('These should be cleaned up or regenerated');
    }

    // Test 4: Check R2 URL Generation
    console.log('\n4️⃣ Testing R2 URL Generation...');
    try {
      // This would normally upload a test image, but we'll just test the URL format
      const testUrl = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/generated-images/test-${Date.now()}.png`;
      
      if (testUrl.includes('pub-') && testUrl.includes('.r2.dev')) {
        console.log('✅ R2 URL generation format is correct');
        console.log(`   Example URL: ${testUrl}`);
      } else {
        console.log('❌ R2 URL generation format is incorrect');
        console.log(`   Generated URL: ${testUrl}`);
      }
    } catch (error) {
      console.log('❌ Error testing R2 URL generation:', error.message);
    }

    // Summary
    console.log('\n📊 Summary:');
    console.log(`- Total active files: ${r2Files.length}`);
    console.log(`- R2 configured: ${r2Service.isConfigured() ? 'Yes' : 'No'}`);
    console.log(`- Problematic URLs: ${problematicFiles.length}`);
    
    const r2Urls = r2Files.filter(f => f.fileUrl.startsWith('https://pub-')).length;
    const base64Urls = r2Files.filter(f => f.fileUrl.startsWith('data:')).length;
    const externalUrls = r2Files.filter(f => f.fileUrl.startsWith('https://') && !f.fileUrl.startsWith('https://pub-')).length;
    
    console.log(`- R2 URLs: ${r2Urls}`);
    console.log(`- Base64 URLs: ${base64Urls}`);
    console.log(`- External URLs: ${externalUrls}`);

    if (r2Service.isConfigured() && problematicFiles.length === 0) {
      console.log('\n✅ Image gallery should be working properly!');
      console.log('New images will be stored in R2 with proper URLs');
    } else {
      console.log('\n⚠️  Some issues remain:');
      if (!r2Service.isConfigured()) {
        console.log('  - R2 is not properly configured');
      }
      if (problematicFiles.length > 0) {
        console.log('  - Some files have problematic URLs');
      }
    }

  } catch (error) {
    console.error('❌ Error during testing:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testCompleteFlow();
