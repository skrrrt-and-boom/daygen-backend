#!/usr/bin/env node

/**
 * Verify Image Migration to R2
 * This script checks that all images have been migrated to R2 and are accessible
 */

const { PrismaClient } = require('@prisma/client');
const fetch = require('node-fetch');
require('dotenv').config();

const prisma = new PrismaClient();

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

function isExternalUrl(url) {
  return !isR2Url(url) && !isBase64Url(url);
}

async function testUrlAccessibility(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      timeout: 10000, // 10 second timeout
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function verifyMigration() {
  console.log('🔍 Verifying image migration to R2...\n');

  try {
    // Get all R2File records
    const files = await prisma.r2File.findMany({
      select: {
        id: true,
        fileName: true,
        fileUrl: true,
        mimeType: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log(`📊 Total files in database: ${files.length}\n`);

    // Categorize files
    const r2Files = files.filter(f => isR2Url(f.fileUrl));
    const base64Files = files.filter(f => isBase64Url(f.fileUrl));
    const externalFiles = files.filter(f => isExternalUrl(f.fileUrl));
    const nullFiles = files.filter(f => !f.fileUrl || f.fileUrl.trim() === '');

    console.log('📈 Migration Status:');
    console.log(`   ✅ R2 URLs: ${r2Files.length}`);
    console.log(`   ❌ Base64 URLs: ${base64Files.length}`);
    console.log(`   ❌ External URLs: ${externalFiles.length}`);
    console.log(`   ❌ NULL/Empty URLs: ${nullFiles.length}`);

    // Test R2 URL accessibility
    if (r2Files.length > 0) {
      console.log('\n🌐 Testing R2 URL accessibility...');
      let accessibleCount = 0;
      let failedCount = 0;

      // Test a sample of R2 URLs (max 10 to avoid too many requests)
      const testFiles = r2Files.slice(0, Math.min(10, r2Files.length));
      
      for (const file of testFiles) {
        const isAccessible = await testUrlAccessibility(file.fileUrl);
        if (isAccessible) {
          console.log(`   ✅ ${file.fileName}: Accessible`);
          accessibleCount++;
        } else {
          console.log(`   ❌ ${file.fileName}: Not accessible`);
          failedCount++;
        }
      }

      console.log(`\n📊 Accessibility Test Results:`);
      console.log(`   ✅ Accessible: ${accessibleCount}/${testFiles.length}`);
      console.log(`   ❌ Failed: ${failedCount}/${testFiles.length}`);
    }

    // Report issues
    const issues = [];
    
    if (base64Files.length > 0) {
      issues.push(`${base64Files.length} files still have base64 URLs`);
    }
    
    if (externalFiles.length > 0) {
      issues.push(`${externalFiles.length} files still have external URLs`);
    }
    
    if (nullFiles.length > 0) {
      issues.push(`${nullFiles.length} files have NULL/empty URLs`);
    }

    console.log('\n📋 Summary:');
    if (issues.length === 0) {
      console.log('🎉 All images have been successfully migrated to R2!');
      console.log('   Your image storage is now standardized and optimized.');
    } else {
      console.log('⚠️  Migration issues found:');
      issues.forEach(issue => console.log(`   - ${issue}`));
      console.log('\n💡 Next steps:');
      if (base64Files.length > 0) {
        console.log('   - Run: node scripts/migrate-images-to-r2.js');
      }
      if (externalFiles.length > 0) {
        console.log('   - Run: node scripts/migrate-external-urls-to-r2.js');
      }
    }

    // Show sample URLs
    if (r2Files.length > 0) {
      console.log('\n🔗 Sample R2 URLs:');
      r2Files.slice(0, 3).forEach(file => {
        console.log(`   - ${file.fileName}: ${file.fileUrl}`);
      });
    }

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run verification
verifyMigration().catch(console.error);
