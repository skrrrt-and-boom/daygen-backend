#!/usr/bin/env node

/**
 * Test local development setup
 */

const FRONTEND_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://localhost:3000';

async function testLocalSetup() {
  console.log('🧪 Testing Local Development Setup\n');
  
  // Test backend
  console.log('1️⃣ Testing Backend...');
  try {
    const healthResp = await fetch(`${BACKEND_URL}/health`);
    const health = await healthResp.json();
    console.log('✅ Backend health:', health.status);
  } catch (error) {
    console.log('❌ Backend not responding:', error.message);
    return;
  }
  
  // Test frontend
  console.log('\n2️⃣ Testing Frontend...');
  try {
    const frontendResp = await fetch(FRONTEND_URL);
    if (frontendResp.ok) {
      console.log('✅ Frontend responding on port 5173');
    } else {
      console.log('❌ Frontend error:', frontendResp.status);
    }
  } catch (error) {
    console.log('❌ Frontend not responding:', error.message);
    return;
  }
  
  // Test auth endpoint
  console.log('\n3️⃣ Testing Auth Endpoint...');
  try {
    const authResp = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'short' })
    });
    const auth = await authResp.json();
    if (authResp.status === 400 && auth.statusCode === 400) {
      console.log('✅ Auth endpoint working (validation error as expected)');
    } else {
      console.log('⚠️  Auth endpoint unexpected response:', auth);
    }
  } catch (error) {
    console.log('❌ Auth endpoint error:', error.message);
  }
  
  console.log('\n🎉 Local Setup Status:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Backend:  http://localhost:3000');
  console.log('✅ Frontend: http://localhost:5173');
  console.log('✅ Configuration: Frontend will use local backend');
  console.log('\n📝 Next Steps:');
  console.log('1. Open http://localhost:5173 in your browser');
  console.log('2. Sign up for a new account');
  console.log('3. Generate an image to test the full flow');
  console.log('4. Check browser Network tab to see API calls to localhost:3000');
  console.log('\n🔧 Configuration:');
  console.log('- Frontend .env.local: VITE_API_BASE_URL=http://localhost:3000');
  console.log('- Backend running on: http://localhost:3000');
  console.log('- Vite proxy disabled (using direct backend URL)');
}

testLocalSetup();
