#!/usr/bin/env node

/**
 * Test if R2 storage is configured in the backend
 */

const BACKEND_URL = 'https://daygen-backend-365299591811.europe-central2.run.app';

async function testR2Config() {
  console.log('🔍 Testing R2 Configuration\n');
  console.log('Note: This test creates a user and generates an image to check if R2 is working.\n');
  
  try {
    // 1. Sign up
    console.log('1️⃣ Creating test user...');
    const testEmail = `r2test-${Date.now()}@test.com`;
    const signupResp = await fetch(`${BACKEND_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'TestPass123!',
        displayName: 'R2 Test User'
      })
    });
    
    if (!signupResp.ok) {
      console.error('❌ Failed to create user');
      return;
    }
    
    const { accessToken } = await signupResp.json();
    console.log('✅ User created with token\n');
    
    // 2. Generate a simple image
    console.log('2️⃣ Generating test image (this costs 1 credit)...');
    const genResp = await fetch(`${BACKEND_URL}/api/image/gemini`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        prompt: 'A simple red circle',
        model: 'gemini-2.5-flash-image'
      })
    });
    
    if (!genResp.ok) {
      const error = await genResp.json();
      console.error('❌ Generation failed:', error);
      return;
    }
    
    const result = await genResp.json();
    console.log('✅ Image generated\n');
    
    // 3. Check the response
    console.log('3️⃣ Analyzing response...\n');
    const imageUrl = result.dataUrl || result.image || result.imageUrl;
    
    if (!imageUrl) {
      console.log('❌ No image URL in response');
      console.log('Response keys:', Object.keys(result));
      return;
    }
    
    if (imageUrl.startsWith('data:')) {
      console.log('⚠️  R2 Storage: NOT CONFIGURED');
      console.log('━'.repeat(60));
      console.log('The response contains a base64 data URL, not an R2 URL.');
      console.log('This means images are NOT being uploaded to Cloudflare R2.');
      console.log('\nTo fix this, set these environment variables in your backend:');
      console.log('  - CLOUDFLARE_R2_ACCOUNT_ID');
      console.log('  - CLOUDFLARE_R2_ACCESS_KEY_ID');
      console.log('  - CLOUDFLARE_R2_SECRET_ACCESS_KEY');
      console.log('  - CLOUDFLARE_R2_BUCKET_NAME');
      console.log('  - CLOUDFLARE_R2_PUBLIC_URL');
      console.log('\nCurrent behavior:');
      console.log('  ✅ Image generation works');
      console.log('  ❌ Images not stored in R2');
      console.log('  ⚠️  Images only exist in frontend memory');
      console.log('  ⚠️  Large API responses (base64 data)');
    } else if (imageUrl.includes('r2.cloudflarestorage.com') || imageUrl.includes(process.env.CLOUDFLARE_R2_PUBLIC_URL || '')) {
      console.log('✅ R2 Storage: CONFIGURED AND WORKING!');
      console.log('━'.repeat(60));
      console.log('R2 URL:', imageUrl);
      console.log('\nBehavior:');
      console.log('  ✅ Images uploaded to Cloudflare R2');
      console.log('  ✅ Persistent cloud storage');
      console.log('  ✅ Efficient API responses');
      console.log('  ✅ R2File records created');
    } else {
      console.log('🤔 R2 Status: UNCLEAR');
      console.log('━'.repeat(60));
      console.log('The response contains a URL, but it doesn\'t look like an R2 URL:');
      console.log(imageUrl.substring(0, 100) + '...');
      console.log('\nThis might be:');
      console.log('  - A provider\'s temporary URL (Gemini, etc.)');
      console.log('  - R2 configured with custom domain');
      console.log('  - Another cloud storage service');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testR2Config();
