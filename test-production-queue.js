#!/usr/bin/env node

/**
 * Test script to verify the queue system works in production
 */

const axios = require('axios');

async function testProductionQueue() {
  const baseURL = 'https://daygen-backend-365299591811.europe-central2.run.app/api';
  
  try {
    console.log('🧪 Testing production queue system...');
    
    // 1. Create a test user
    console.log('1. Creating test user...');
    const timestamp = Date.now();
    const signupResponse = await axios.post(`${baseURL}/auth/signup`, {
      email: `test${timestamp}@example.com`,
      password: 'testpassword123',
      name: 'Test User'
    });
    const token = signupResponse.data.accessToken;
    console.log('✅ User created, token:', token.substring(0, 20) + '...');

    // 2. Create a real job
    console.log('\n2. Creating image generation job...');
    const jobResponse = await axios.post(`${baseURL}/jobs/image-generation`, {
      prompt: 'A beautiful sunset over mountains',
      model: 'flux-1.1',
      provider: 'flux',
      options: { width: 512, height: 512 }
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const jobId = jobResponse.data.jobId;
    console.log('✅ Job created:', jobId);

    // 3. Check job status immediately
    console.log('\n3. Checking initial job status...');
    const initialStatus = await axios.get(`${baseURL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Initial status:', initialStatus.data.status, initialStatus.data.progress + '%');

    // 4. Wait and check status multiple times
    console.log('\n4. Monitoring job progress...');
    for (let i = 0; i < 15; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      try {
        const statusResponse = await axios.get(`${baseURL}/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const status = statusResponse.data;
        console.log(`Check ${i + 1}: ${status.status} (${status.progress}%)`);
        
        if (status.status === 'COMPLETED') {
          console.log('✅ Job completed successfully!');
          console.log('Result URL:', status.resultUrl);
          break;
        } else if (status.status === 'FAILED') {
          console.log('❌ Job failed:', status.error);
          break;
        }
      } catch (error) {
        console.log(`Check ${i + 1}: Error checking status -`, error.response?.data || error.message);
      }
    }

    // 5. Final status check
    console.log('\n5. Final status check...');
    const finalStatus = await axios.get(`${baseURL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Final status:', finalStatus.data);

    console.log('\n🎉 Production queue test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

if (require.main === module) {
  testProductionQueue();
}

module.exports = { testProductionQueue };