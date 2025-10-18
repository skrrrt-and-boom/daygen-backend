#!/usr/bin/env node

/**
 * Test script to debug the task processor endpoint
 */

const axios = require('axios');

async function testTaskProcessor() {
  const baseURL = 'http://localhost:3000/api';
  
  try {
    console.log('🧪 Testing task processor endpoint...');
    
    // Test with minimal payload
    const response = await axios.post(`${baseURL}/jobs/process`, {
      jobId: 'test-job-123',
      userId: 'test-user-123',
      jobType: 'IMAGE_GENERATION',
      prompt: 'test prompt',
      model: 'flux-1.1',
      provider: 'flux',
      options: {}
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer internal-key',
      },
    });

    console.log('Response status:', response.status);
    console.log('Response data:', response.data);
    console.log('✅ Task processor endpoint working');

  } catch (error) {
    console.log('Response status:', error.response?.status);
    console.log('Response data:', error.response?.data);
    console.log('❌ Task processor endpoint failed:', error.message);
  }
}

if (require.main === module) {
  testTaskProcessor();
}

module.exports = { testTaskProcessor };
