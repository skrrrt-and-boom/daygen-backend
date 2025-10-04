const axios = require('axios');

async function testCloudTasks() {
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

    // 2. Create a job using Cloud Tasks
    console.log('\n2. Creating image generation job with Cloud Tasks...');
    const jobResponse = await axios.post(`${baseURL}/jobs/image-generation`, {
      prompt: 'A beautiful sunset over mountains',
      model: 'flux-1.1-pro',
      provider: 'flux',
      options: { width: 1024, height: 1024 }
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const jobId = jobResponse.data.jobId;
    console.log('✅ Job created:', jobId);

    // 3. Check job status
    console.log('\n3. Checking job status...');
    const statusResponse = await axios.get(`${baseURL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('✅ Job status:', statusResponse.data);

    // 4. Wait and check again
    console.log('\n4. Waiting 15 seconds and checking again...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    const finalStatusResponse = await axios.get(`${baseURL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('✅ Final job status:', finalStatusResponse.data);

    // 5. Check user jobs
    console.log('\n5. Checking user jobs list...');
    const jobsResponse = await axios.get(`${baseURL}/jobs`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('✅ User jobs:', jobsResponse.data);

    console.log('\n🎉 Cloud Tasks test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    if (error.response?.status === 401) {
      console.log('💡 Make sure the backend is running and the user was created successfully');
    }
  }
}

testCloudTasks();
