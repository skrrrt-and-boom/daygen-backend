#!/usr/bin/env node

/**
 * Test script to verify frontend can connect to the NestJS backend
 */

const BACKEND_URL = 'https://daygen-backend-365299591811.europe-central2.run.app';

async function testHealthEndpoint() {
  console.log('🔍 Testing health endpoint...');
  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    const data = await response.json();
    console.log('✅ Health check passed:', data);
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

async function testAuthEndpoint() {
  console.log('\n🔍 Testing auth endpoint structure...');
  try {
    // This should fail with validation error (which means endpoint works)
    const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'short' })
    });
    const data = await response.json();
    
    if (response.status === 400 && data.statusCode === 400) {
      console.log('✅ Auth endpoint is responding correctly (validation working)');
      return true;
    } else {
      console.log('⚠️  Auth endpoint returned unexpected response:', data);
      return false;
    }
  } catch (error) {
    console.error('❌ Auth endpoint failed:', error.message);
    return false;
  }
}

async function testSignup() {
  console.log('\n🔍 Testing signup endpoint...');
  try {
    const testEmail = `test-${Date.now()}@daygen.test`;
    const response = await fetch(`${BACKEND_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'TestPassword123!',
        displayName: 'Test User'
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.accessToken && data.user) {
        console.log('✅ Signup successful! Token received:', data.accessToken.substring(0, 20) + '...');
        console.log('✅ User created:', data.user.email, 'with', data.user.credits, 'credits');
        return { success: true, token: data.accessToken, user: data.user };
      }
    } else {
      const error = await response.json();
      if (error.message?.includes('already exists')) {
        console.log('⚠️  User already exists (this is OK for testing)');
        return { success: true, alreadyExists: true };
      }
      console.log('❌ Signup failed:', error);
      return { success: false };
    }
  } catch (error) {
    console.error('❌ Signup test failed:', error.message);
    return { success: false };
  }
}

async function testAuthenticatedEndpoint(token) {
  console.log('\n🔍 Testing authenticated endpoint (/api/auth/me)...');
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      const user = await response.json();
      console.log('✅ Authenticated endpoint working! User:', user.email, 'Credits:', user.credits);
      return true;
    } else {
      console.log('❌ Authenticated endpoint failed:', response.status);
      return false;
    }
  } catch (error) {
    console.error('❌ Authenticated endpoint test failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Testing Backend Connection');
  console.log('Backend URL:', BACKEND_URL);
  console.log('=' .repeat(60));
  
  const healthOk = await testHealthEndpoint();
  if (!healthOk) {
    console.log('\n❌ Backend is not accessible. Check if it\'s deployed and running.');
    process.exit(1);
  }
  
  const authOk = await testAuthEndpoint();
  if (!authOk) {
    console.log('\n⚠️  Auth endpoint may have issues.');
  }
  
  const signupResult = await testSignup();
  if (signupResult.success && signupResult.token) {
    await testAuthenticatedEndpoint(signupResult.token);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Backend integration tests complete!');
  console.log('\n📝 Next steps:');
  console.log('1. Start the frontend: npm run dev');
  console.log('2. Open http://localhost:5173 in your browser');
  console.log('3. Try signing up and generating an image');
  console.log('4. Check the Network tab to see API calls to:', BACKEND_URL);
}

runTests().catch(console.error);
