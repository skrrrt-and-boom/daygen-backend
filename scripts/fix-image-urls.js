const { PrismaClient } = require('@prisma/client');
const fetch = require('node-fetch').default || require('node-fetch');

const prisma = new PrismaClient();

async function fixImageUrls() {
  console.log('🔧 Fixing image URLs...\n');
  
  try {
    // Find all R2File records with problematic URLs
    const problematicFiles = await prisma.r2File.findMany({
      where: {
        OR: [
          { fileUrl: { startsWith: 'https://delivery-eu4.bfl.ai' } },
          { fileUrl: { startsWith: 'https://storage.cdn-luma.com' } },
          { fileUrl: { startsWith: 'https://' } },
        ],
        NOT: [
          { fileUrl: { startsWith: 'https://pub-' } },
          { fileUrl: { startsWith: 'data:' } },
        ]
      }
    });

    console.log(`Found ${problematicFiles.length} files with problematic URLs`);

    for (const file of problematicFiles) {
      console.log(`\nProcessing file: ${file.id}`);
      console.log(`Current URL: ${file.fileUrl.substring(0, 100)}...`);
      
      try {
        // Try to fetch the image
        const response = await fetch(file.fileUrl, { 
          method: 'HEAD',
          timeout: 10000 
        });
        
        if (response.ok) {
          console.log('✅ URL is accessible');
          continue;
        } else {
          console.log(`❌ URL returned ${response.status}: ${response.statusText}`);
          
          // Mark as deleted since we can't access it
          await prisma.r2File.update({
            where: { id: file.id },
            data: { 
              deletedAt: new Date(),
              updatedAt: new Date()
            }
          });
          
          console.log('🗑️  Marked as deleted');
        }
      } catch (error) {
        console.log(`❌ Error accessing URL: ${error.message}`);
        
        // Mark as deleted since we can't access it
        await prisma.r2File.update({
          where: { id: file.id },
          data: { 
            deletedAt: new Date(),
            updatedAt: new Date()
          }
        });
        
        console.log('🗑️  Marked as deleted');
      }
    }

    console.log('\n✅ Image URL cleanup complete!');
    
    // Show summary
    const remainingFiles = await prisma.r2File.count({
      where: { deletedAt: null }
    });
    
    const deletedFiles = await prisma.r2File.count({
      where: { deletedAt: { not: null } }
    });
    
    console.log(`\n📊 Summary:`);
    console.log(`- Active files: ${remainingFiles}`);
    console.log(`- Deleted files: ${deletedFiles}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixImageUrls();
