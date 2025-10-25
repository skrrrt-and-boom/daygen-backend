#!/usr/bin/env node

/**
 * Comprehensive production readiness test
 */

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000';

async function testHealth() {
  console.log('🏥 Testing health endpoint...');
  try {
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();
    
    if (response.ok && data.status === 'ok') {
      console.log('✅ Health check passed');
      return true;
    } else {
      console.log('❌ Health check failed:', data);
      return false;
    }
  } catch (error) {
    console.log('❌ Health check error:', error.message);
    return false;
  }
}

async function testAuthFlow() {
  console.log('\n🔐 Testing authentication flow...');
  
  try {
    // Test signup
    console.log('  Testing signup...');
    const signupResponse = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword123',
        name: 'Test User'
      })
    });
    
    if (signupResponse.ok) {
      console.log('  ✅ Signup successful');
    } else {
      const error = await signupResponse.text();
      console.log('  ⚠️  Signup response:', error);
    }
    
    // Test login
    console.log('  Testing login...');
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
      console.log('  ✅ Login successful');
      return loginData.accessToken;
    } else {
      const error = await loginResponse.text();
      console.log('  ❌ Login failed:', error);
      return null;
    }
  } catch (error) {
    console.log('  ❌ Auth flow error:', error.message);
    return null;
  }
}

async function testGeminiGeneration(token) {
  console.log('\n🤖 Testing Gemini image generation...');
  
  if (!token) {
    console.log('  ⚠️  Skipping - no auth token');
    return false;
  }
  
  try {
    const response = await fetch(`${BASE_URL}/api/image/gemini`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        prompt: 'Generate a simple red apple on a white background',
        model: 'gemini-2.5-flash-image'
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.imageUrl) {
        console.log('  ✅ Gemini generation successful');
        console.log('  📸 Image URL:', data.imageUrl);
        return true;
      } else {
        console.log('  ❌ No image URL in response');
        return false;
      }
    } else {
      const error = await response.text();
      console.log('  ❌ Gemini generation failed:', error);
      return false;
    }
  } catch (error) {
    console.log('  ❌ Gemini generation error:', error.message);
    return false;
  }
}

async function testR2FileManagement(token) {
  console.log('\n📁 Testing R2 file management...');
  
  if (!token) {
    console.log('  ⚠️  Skipping - no auth token');
    return false;
  }
  
  try {
    // Test listing files
    const listResponse = await fetch(`${BASE_URL}/api/r2files`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (listResponse.ok) {
      const files = await listResponse.json();
      console.log('  ✅ R2 files listing successful');
      console.log('  📊 Files count:', files.length);
      return true;
    } else {
      const error = await listResponse.text();
      console.log('  ❌ R2 files listing failed:', error);
      return false;
    }
  } catch (error) {
    console.log('  ❌ R2 file management error:', error.message);
    return false;
  }
}

async function testUserProfile(token) {
  console.log('\n👤 Testing user profile...');
  
  if (!token) {
    console.log('  ⚠️  Skipping - no auth token');
    return false;
  }
  
  try {
    const response = await fetch(`${BASE_URL}/api/users/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const profile = await response.json();
      console.log('  ✅ User profile retrieval successful');
      console.log('  👤 User email:', profile.email);
      return true;
    } else {
      const error = await response.text();
      console.log('  ❌ User profile failed:', error);
      return false;
    }
  } catch (error) {
    console.log('  ❌ User profile error:', error.message);
    return false;
  }
}

async function testUsageTracking(token) {
  console.log('\n📊 Testing usage tracking...');
  
  if (!token) {
    console.log('  ⚠️  Skipping - no auth token');
    return false;
  }
  
  try {
    const response = await fetch(`${BASE_URL}/api/usage/events`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const usage = await response.json();
      console.log('  ✅ Usage tracking successful');
      console.log('  📈 Events count:', usage.length);
      return true;
    } else {
      const error = await response.text();
      console.log('  ❌ Usage tracking failed:', error);
      return false;
    }
  } catch (error) {
    console.log('  ❌ Usage tracking error:', error.message);
    return false;
  }
}

async function runProductionTests() {
  console.log('🚀 Starting comprehensive production readiness tests...\n');
  
  const results = {
    health: false,
    auth: false,
    gemini: false,
    r2files: false,
    profile: false,
    usage: false
  };
  
  // Test health
  results.health = await testHealth();
  
  // Test authentication
  const token = await testAuthFlow();
  results.auth = token !== null;
  
  // Test Gemini generation
  results.gemini = await testGeminiGeneration(token);
  
  // Test R2 file management
  results.r2files = await testR2FileManagement(token);
  
  // Test user profile
  results.profile = await testUserProfile(token);
  
  // Test usage tracking
  results.usage = await testUsageTracking(token);
  
  // Summary
  console.log('\n📋 Test Results Summary:');
  console.log('========================');
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${test.toUpperCase()}: ${passed ? 'PASSED' : 'FAILED'}`);
  });
  
  const passedTests = Object.values(results).filter(Boolean).length;
  const totalTests = Object.keys(results).length;
  
  console.log(`\n🎯 Overall: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! Backend is production ready!');
    return true;
  } else {
    console.log('⚠️  Some tests failed. Backend needs attention before production.');
    return false;
  }
}

// Run the tests
runProductionTests().catch((error) => {
  console.error('💥 Test suite error:', error);
  process.exit(1);
});
