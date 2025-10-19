const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');
const http = require('http');

// Load environment variables
require('dotenv').config();

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'daygen-assets';
const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL;

console.log('\n🔍 Testing R2 Configuration...\n');
console.log('Configuration:');
console.log('- Account ID:', R2_ACCOUNT_ID ? '✅ Set' : '❌ Missing');
console.log('- Access Key ID:', R2_ACCESS_KEY_ID ? '✅ Set' : '❌ Missing');
console.log('- Secret Access Key:', R2_SECRET_ACCESS_KEY ? '✅ Set' : '❌ Missing');
console.log('- Bucket Name:', R2_BUCKET_NAME);
console.log('- Public URL:', R2_PUBLIC_URL || '❌ Not set');

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_PUBLIC_URL) {
  console.error('\n❌ Missing required R2 configuration. Please check your .env file.');
  process.exit(1);
}

// Initialize S3 client for R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
  useAccelerateEndpoint: false,
  disableHostPrefix: true,
});

// Create a simple test image (1x1 red pixel PNG)
const createTestImage = () => {
  // Base64 encoded 1x1 red pixel PNG
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  return Buffer.from(base64, 'base64');
};

// Test if URL is accessible
const testUrlAccess = (url) => {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (res) => {
      if (res.statusCode === 200) {
        resolve({ success: true, status: res.statusCode });
      } else {
        resolve({ success: false, status: res.statusCode, error: `HTTP ${res.statusCode}` });
      }
    }).on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
};

async function testR2Upload() {
  try {
    console.log('\n📤 Step 1: Uploading test image to R2...');
    
    const testImageBuffer = createTestImage();
    const timestamp = Date.now();
    const fileName = `test-images/test-${timestamp}.png`;
    
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: fileName,
      Body: testImageBuffer,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000',
    });

    await s3Client.send(command);
    console.log('✅ Upload successful!');
    
    // Construct public URL
    const publicUrl = `${R2_PUBLIC_URL}/${fileName}`;
    console.log('\n📋 Generated Public URL:');
    console.log(publicUrl);
    
    console.log('\n🔍 Step 2: Testing URL accessibility...');
    console.log('Waiting 2 seconds for R2 to process...');
    
    // Wait a bit for R2 to process
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const result = await testUrlAccess(publicUrl);
    
    if (result.success) {
      console.log('✅ Image is publicly accessible!');
      console.log(`   Status: ${result.status}`);
    } else {
      console.log('❌ Image is NOT accessible');
      console.log(`   Error: ${result.error || result.status}`);
      console.log('\n🔧 Possible issues:');
      console.log('   1. Public access not enabled on R2 bucket');
      console.log('   2. Public URL might be incorrect');
      console.log('   3. R2 needs a few more seconds to process');
      console.log('\n💡 Try accessing the URL manually in your browser:');
      console.log(`   ${publicUrl}`);
    }
    
    console.log('\n✨ Test Summary:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📤 Upload:      ✅ Success');
    console.log(`🔗 Public URL:  ${result.success ? '✅' : '⚠️'} ${result.success ? 'Accessible' : 'Check manually'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (result.success) {
      console.log('\n🎉 R2 is configured correctly!');
      console.log('✅ Images will now display in your gallery.');
      console.log('\n📝 Next steps:');
      console.log('   1. Generate a new image in your app');
      console.log('   2. Check that it appears in the gallery');
      console.log('   3. Verify the image loads correctly');
    } else {
      console.log('\n⚠️  Upload works but URL needs verification');
      console.log('📝 Next steps:');
      console.log('   1. Open the URL above in your browser');
      console.log('   2. If it shows 404, enable "Public Access" in Cloudflare Dashboard');
      console.log('   3. If it works, your configuration is correct!');
    }
    
  } catch (error) {
    console.error('\n❌ Error during test:');
    console.error(error.message);
    
    if (error.Code === 'NoSuchBucket') {
      console.error('\n💡 The bucket does not exist. Please verify:');
      console.error(`   CLOUDFLARE_R2_BUCKET_NAME="${R2_BUCKET_NAME}"`);
    } else if (error.Code === 'InvalidAccessKeyId' || error.Code === 'SignatureDoesNotMatch') {
      console.error('\n💡 Authentication failed. Please verify your credentials in .env');
    }
    
    process.exit(1);
  }
}

// Run the test
testR2Upload();

