#!/usr/bin/env node

// Use built-in fetch in Node.js 18+
const fetch = globalThis.fetch || require('node-fetch');

const BASE_URL = 'http://localhost:3000';

async function testImageGeneration() {
  console.log('🧪 Testing image generation...');
  
  try {
    // First, try to create a test user
    console.log('  Creating test user...');
    const signupResponse = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword123',
        name: 'Test User'
      })
    });
    
    let token = null;
    
    if (signupResponse.ok) {
      const signupData = await signupResponse.json();
      token = signupData.accessToken;
      console.log('  ✅ Test user created successfully');
    } else {
      // Try to login with existing user
      console.log('  Trying to login with existing user...');
      const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'testpassword123'
        })
      });
      
      if (loginResponse.ok) {
        const loginData = await loginResponse.json();
        token = loginData.accessToken;
        console.log('  ✅ Login successful');
      } else {
        console.log('  ❌ Authentication failed');
        return false;
      }
    }
    
    if (!token) {
      console.log('  ❌ No authentication token');
      return false;
    }
    
    // Test Gemini image generation
    console.log('  Testing Gemini image generation...');
    const geminiResponse = await fetch(`${BASE_URL}/api/image/gemini`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        prompt: 'a beautiful sunset over mountains',
        model: 'gemini-2.5-flash-image-preview'
      })
    });
    
    if (geminiResponse.ok) {
      const geminiData = await geminiResponse.json();
      console.log('  ✅ Gemini image generation request successful');
      console.log('  📋 Response:', JSON.stringify(geminiData, null, 2));
      
      // If it's a job-based response, check job status
      if (geminiData.jobId) {
        console.log('  🔄 Checking job status...');
        const jobResponse = await fetch(`${BASE_URL}/api/jobs/${geminiData.jobId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (jobResponse.ok) {
          const jobData = await jobResponse.json();
          console.log('  📋 Job status:', JSON.stringify(jobData, null, 2));
        } else {
          console.log('  ❌ Failed to check job status');
        }
      }
      
      return true;
    } else {
      const errorData = await geminiResponse.json();
      console.log('  ❌ Gemini image generation failed:', errorData);
      return false;
    }
    
  } catch (error) {
    console.log('  ❌ Error:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting image generation test...\n');
  
  const success = await testImageGeneration();
  
  if (success) {
    console.log('\n✅ Image generation test completed successfully!');
  } else {
    console.log('\n❌ Image generation test failed!');
  }
}

main().catch(console.error);
