const { S3Client, HeadBucketCommand, GetBucketCorsCommand } = require('@aws-sdk/client-s3');

async function verifyR2Setup() {
  console.log('🔍 Verifying R2 Setup and Configuration\n');
  
  // Check environment variables
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;

  console.log('1️⃣ Environment Variables:');
  console.log('CLOUDFLARE_R2_ACCOUNT_ID:', accountId ? 'SET' : 'NOT_SET');
  console.log('CLOUDFLARE_R2_ACCESS_KEY_ID:', accessKeyId ? 'SET' : 'NOT_SET');
  console.log('CLOUDFLARE_R2_SECRET_ACCESS_KEY:', secretAccessKey ? 'SET' : 'NOT_SET');
  console.log('CLOUDFLARE_R2_BUCKET_NAME:', bucketName || 'NOT_SET');
  console.log('CLOUDFLARE_R2_PUBLIC_URL:', publicUrl || 'NOT_SET');

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
    console.log('\n❌ Missing R2 environment variables');
    console.log('Run: ./scripts/restore-r2-config.sh');
    return;
  }

  // Validate public URL format
  console.log('\n2️⃣ Public URL Validation:');
  if (publicUrl.includes('pub-') && publicUrl.includes('.r2.dev')) {
    console.log('✅ Public URL format is correct (starts with pub-)');
  } else {
    console.log('❌ Public URL format is incorrect');
    console.log('Expected format: https://pub-xxx.r2.dev');
    console.log('Current format:', publicUrl);
  }

  // Test S3Client connection
  console.log('\n3️⃣ Testing R2 Connection:');
  try {
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Test bucket access
    const headCommand = new HeadBucketCommand({ Bucket: bucketName });
    await s3Client.send(headCommand);
    console.log('✅ Bucket access successful');

    // Check CORS configuration
    try {
      const corsCommand = new GetBucketCorsCommand({ Bucket: bucketName });
      const corsResponse = await s3Client.send(corsCommand);
      
      if (corsResponse.CORSRules && corsResponse.CORSRules.length > 0) {
        console.log('✅ CORS configuration found');
        corsResponse.CORSRules.forEach((rule, index) => {
          console.log(`   Rule ${index + 1}:`, rule.AllowedOrigins?.join(', ') || 'No origins');
        });
      } else {
        console.log('⚠️  No CORS configuration found');
        console.log('   You may need to configure CORS for your domain');
      }
    } catch (corsError) {
      console.log('⚠️  Could not retrieve CORS configuration:', corsError.message);
    }

  } catch (error) {
    console.log('❌ R2 connection failed:', error.message);
    
    if (error.message.includes('AccessDenied')) {
      console.log('   This usually means:');
      console.log('   - Bucket does not exist');
      console.log('   - Credentials are incorrect');
      console.log('   - Bucket is not publicly accessible');
    }
    
    if (error.message.includes('NoSuchBucket')) {
      console.log('   Bucket does not exist. Create it in Cloudflare dashboard.');
    }
  }

  console.log('\n4️⃣ Configuration Summary:');
  console.log('Bucket Name:', bucketName);
  console.log('Public URL:', publicUrl);
  console.log('Expected Image URL Format:', `${publicUrl}/generated-images/uuid.png`);
  
  console.log('\n📋 Next Steps:');
  console.log('1. Ensure bucket has public access enabled in Cloudflare dashboard');
  console.log('2. Configure CORS policy for your domain');
  console.log('3. Test image generation to verify URLs start with "pub-"');
  console.log('4. Check gallery to ensure no 403 errors');
}

verifyR2Setup().catch(console.error);
