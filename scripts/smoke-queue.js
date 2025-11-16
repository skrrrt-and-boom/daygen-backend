const axios = require('axios');

async function testCloudTasksSimple() {
  const baseURL = 'http://localhost:3000/api';
  
  try {
    // 1. Sign up a test user
    console.log('1. Creating test user...');
    const timestamp = Date.now();
    const signupResponse = await axios.post(`${baseURL}/auth/signup`, {
      email: `test${timestamp}@example.com`,
      password: 'testpassword123'
    });
    const token = signupResponse.data.accessToken;
    console.log('✅ User created, token:', token.substring(0, 20) + '...');

    // 2. Test job status endpoint
    console.log('\n2. Testing job status endpoint...');
    try {
      const statusResponse = await axios.get(`${baseURL}/jobs/nonexistent-job`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log('❌ Should have failed:', statusResponse.data);
    } catch (error) {
      if (error.response?.status === 404 || error.response?.data?.message?.includes('not found')) {
        console.log('✅ Job status endpoint working (correctly returned 404)');
      } else {
        console.log('❌ Unexpected error:', error.response?.data || error.message);
      }
    }

    // 3. Test user jobs endpoint
    console.log('\n3. Testing user jobs endpoint...');
    const jobsResponse = await axios.get(`${baseURL}/jobs`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('✅ User jobs endpoint working:', jobsResponse.data);

    console.log('\n🎉 Basic Cloud Tasks endpoints test completed!');
    console.log('\nNote: Job creation will fail until Cloud Tasks authentication is set up.');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testCloudTasksSimple();


