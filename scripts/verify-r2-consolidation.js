const { PrismaClient } = require('@prisma/client');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
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

// Check if URL is an R2 public URL
function isR2Url(url) {
  return url && url.startsWith(publicUrl);
}

// Check if URL is base64 data URL
function isBase64Url(url) {
  return url && url.startsWith('data:image/');
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

// Verify R2 bucket structure
async function verifyBucketStructure() {
  console.log('🔍 Verifying R2 bucket structure...\n');
  
  try {
    // List all objects in the bucket
    const allObjects = await listObjectsWithPrefix('');
    console.log(`📊 Total objects in bucket: ${allObjects.length}`);
    
    // Group objects by prefix
    const prefixCounts = {};
    const problematicPrefixes = [];
    
    allObjects.forEach(obj => {
      const prefix = obj.Key.split('/')[0] + '/';
      prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
      
      // Check for problematic prefixes
      if (prefix === 'migrated-external/' || prefix === 'migrated-images/') {
        problematicPrefixes.push(obj.Key);
      }
    });
    
    console.log('\n📁 Objects by prefix:');
    Object.entries(prefixCounts).forEach(([prefix, count]) => {
      const status = (prefix === 'migrated-external/' || prefix === 'migrated-images/') ? '❌' : '✅';
      console.log(`   ${status} ${prefix}: ${count} objects`);
    });
    
    if (problematicPrefixes.length > 0) {
      console.log(`\n❌ Found ${problematicPrefixes.length} objects in old migrated directories:`);
      problematicPrefixes.slice(0, 10).forEach(key => {
        console.log(`   - ${key}`);
      });
      if (problematicPrefixes.length > 10) {
        console.log(`   ... and ${problematicPrefixes.length - 10} more`);
      }
    } else {
      console.log('\n✅ No objects found in old migrated directories');
    }
    
    return {
      totalObjects: allObjects.length,
      prefixCounts,
      problematicPrefixes: problematicPrefixes.length,
      hasIssues: problematicPrefixes.length > 0
    };
    
  } catch (error) {
    console.error('❌ Failed to verify bucket structure:', error.message);
    return { hasIssues: true, error: error.message };
  }
}

// Verify R2File records
async function verifyR2FileRecords() {
  console.log('\n🔍 Verifying R2File records...\n');
  
  try {
    const r2Files = await prisma.r2File.findMany({
      select: {
        id: true,
        fileUrl: true,
        fileName: true,
        createdAt: true
      }
    });
    
    console.log(`📊 Total R2File records: ${r2Files.length}`);
    
    let r2UrlCount = 0;
    let base64Count = 0;
    let externalUrlCount = 0;
    let nullUrlCount = 0;
    const issues = [];
    
    r2Files.forEach(file => {
      if (!file.fileUrl) {
        nullUrlCount++;
        issues.push({ type: 'R2File', id: file.id, issue: 'null fileUrl' });
      } else if (isR2Url(file.fileUrl)) {
        r2UrlCount++;
      } else if (isBase64Url(file.fileUrl)) {
        base64Count++;
        issues.push({ type: 'R2File', id: file.id, issue: 'base64 URL', url: file.fileUrl });
      } else {
        externalUrlCount++;
        issues.push({ type: 'R2File', id: file.id, issue: 'external URL', url: file.fileUrl });
      }
    });
    
    console.log('\n📈 R2File URL types:');
    console.log(`   ✅ R2 URLs: ${r2UrlCount}`);
    console.log(`   ❌ Base64 URLs: ${base64Count}`);
    console.log(`   ❌ External URLs: ${externalUrlCount}`);
    console.log(`   ❌ Null URLs: ${nullUrlCount}`);
    
    if (issues.length > 0) {
      console.log(`\n❌ Found ${issues.length} R2File issues:`);
      issues.slice(0, 10).forEach(({ type, id, issue, url }) => {
        console.log(`   - ${type} ${id}: ${issue}${url ? ` (${url})` : ''}`);
      });
      if (issues.length > 10) {
        console.log(`   ... and ${issues.length - 10} more`);
      }
    } else {
      console.log('\n✅ All R2File records have valid R2 URLs');
    }
    
    return {
      total: r2Files.length,
      r2UrlCount,
      base64Count,
      externalUrlCount,
      nullUrlCount,
      issues: issues.length,
      hasIssues: issues.length > 0
    };
    
  } catch (error) {
    console.error('❌ Failed to verify R2File records:', error.message);
    return { hasIssues: true, error: error.message };
  }
}

// Verify Job records
async function verifyJobRecords() {
  console.log('\n🔍 Verifying Job records...\n');
  
  try {
    const jobs = await prisma.job.findMany({
      where: {
        resultUrl: { not: null }
      },
      select: {
        id: true,
        resultUrl: true,
        type: true,
        status: true,
        createdAt: true
      }
    });
    
    console.log(`📊 Total Job records with resultUrl: ${jobs.length}`);
    
    let r2UrlCount = 0;
    let base64Count = 0;
    let externalUrlCount = 0;
    const issues = [];
    
    jobs.forEach(job => {
      if (isR2Url(job.resultUrl)) {
        r2UrlCount++;
      } else if (isBase64Url(job.resultUrl)) {
        base64Count++;
        issues.push({ type: 'Job', id: job.id, issue: 'base64 URL', url: job.resultUrl });
      } else {
        externalUrlCount++;
        issues.push({ type: 'Job', id: job.id, issue: 'external URL', url: job.resultUrl });
      }
    });
    
    console.log('\n📈 Job resultUrl types:');
    console.log(`   ✅ R2 URLs: ${r2UrlCount}`);
    console.log(`   ❌ Base64 URLs: ${base64Count}`);
    console.log(`   ❌ External URLs: ${externalUrlCount}`);
    
    if (issues.length > 0) {
      console.log(`\n❌ Found ${issues.length} Job issues:`);
      issues.slice(0, 10).forEach(({ type, id, issue, url }) => {
        console.log(`   - ${type} ${id}: ${issue}${url ? ` (${url})` : ''}`);
      });
      if (issues.length > 10) {
        console.log(`   ... and ${issues.length - 10} more`);
      }
    } else {
      console.log('\n✅ All Job records have valid R2 URLs');
    }
    
    return {
      total: jobs.length,
      r2UrlCount,
      base64Count,
      externalUrlCount,
      issues: issues.length,
      hasIssues: issues.length > 0
    };
    
  } catch (error) {
    console.error('❌ Failed to verify Job records:', error.message);
    return { hasIssues: true, error: error.message };
  }
}

// Main verification function
async function verifyR2Consolidation() {
  console.log('🔍 Starting R2 consolidation verification...\n');
  
  checkR2Configuration();
  
  try {
    // Verify bucket structure
    const bucketResults = await verifyBucketStructure();
    
    // Verify R2File records
    const r2FileResults = await verifyR2FileRecords();
    
    // Verify Job records
    const jobResults = await verifyJobRecords();
    
    // Overall summary
    console.log('\n🎯 Overall Verification Summary:');
    console.log('================================');
    
    const hasAnyIssues = bucketResults.hasIssues || r2FileResults.hasIssues || jobResults.hasIssues;
    
    if (hasAnyIssues) {
      console.log('❌ Issues found that need attention:');
      
      if (bucketResults.hasIssues) {
        console.log(`   - Bucket: ${bucketResults.problematicPrefixes || 0} objects in old directories`);
      }
      
      if (r2FileResults.hasIssues) {
        console.log(`   - R2File: ${r2FileResults.issues || 0} records with non-R2 URLs`);
      }
      
      if (jobResults.hasIssues) {
        console.log(`   - Job: ${jobResults.issues || 0} records with non-R2 URLs`);
      }
      
      console.log('\n💡 Recommendations:');
      if (bucketResults.problematicPrefixes > 0) {
        console.log('   - Run consolidate-r2-images.js to move files to generated-images/');
      }
      if (r2FileResults.issues > 0 || jobResults.issues > 0) {
        console.log('   - Run update-db-urls-to-r2.js to update database URLs');
      }
    } else {
      console.log('✅ All checks passed! R2 consolidation is complete.');
      console.log('   - Bucket structure is clean');
      console.log('   - All R2File records use R2 URLs');
      console.log('   - All Job records use R2 URLs');
    }
    
    // Detailed statistics
    console.log('\n📊 Detailed Statistics:');
    console.log(`   Bucket objects: ${bucketResults.totalObjects || 0}`);
    console.log(`   R2File records: ${r2FileResults.total || 0} (${r2FileResults.r2UrlCount || 0} R2 URLs)`);
    console.log(`   Job records: ${jobResults.total || 0} (${jobResults.r2UrlCount || 0} R2 URLs)`);
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the verification
if (require.main === module) {
  verifyR2Consolidation().catch(console.error);
}

module.exports = { verifyR2Consolidation };
