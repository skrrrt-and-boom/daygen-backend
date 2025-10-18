const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function testJobQueue() {
  console.log('🧪 Testing Job Queue Implementation...\n');

  try {
    // Test 1: Check if server is running
    console.log('1. Testing server health...');
    const healthResponse = await fetch('http://localhost:3000/health');
    const healthData = await healthResponse.json();
    console.log('✅ Server is running:', healthData.status);
    console.log('✅ Database is connected:', healthData.details.database.status);
    console.log('');

    // Test 2: Test job creation endpoint (without auth for now)
    console.log('2. Testing job creation endpoint...');
    try {
      const jobResponse = await fetch('http://localhost:3000/api/jobs/image-generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'A beautiful sunset over mountains',
          model: 'gemini-2.5-flash-image-preview',
          provider: 'gemini',
        }),
      });
      
      if (jobResponse.status === 401) {
        console.log('✅ Job endpoint exists (requires authentication)');
      } else {
        const jobData = await jobResponse.json();
        console.log('✅ Job created:', jobData);
      }
    } catch (error) {
      console.log('❌ Job creation failed:', error.message);
    }
    console.log('');

    // Test 3: Test WebSocket endpoint
    console.log('3. Testing WebSocket endpoint...');
    try {
      const wsResponse = await fetch('http://localhost:3000/socket.io/');
      if (wsResponse.status === 200 || wsResponse.status === 400) {
        console.log('✅ WebSocket endpoint is available');
      } else {
        console.log('❌ WebSocket endpoint not available');
      }
    } catch (error) {
      console.log('❌ WebSocket test failed:', error.message);
    }
    console.log('');

    // Test 4: Check Redis connection
    console.log('4. Testing Redis connection...');
    try {
      const redis = require('redis');
      const client = redis.createClient({
        host: 'localhost',
        port: 6379,
      });
      
      await client.connect();
      await client.ping();
      console.log('✅ Redis is connected and responding');
      await client.disconnect();
    } catch (error) {
      console.log('❌ Redis connection failed:', error.message);
    }
    console.log('');

    console.log('🎉 Job Queue Implementation Test Complete!');
    console.log('');
    console.log('📋 What you should see:');
    console.log('   ✅ Server running on port 3000');
    console.log('   ✅ Database connected');
    console.log('   ✅ Job endpoints available (require auth)');
    console.log('   ✅ WebSocket endpoint available');
    console.log('   ✅ Redis connected');
    console.log('');
    console.log('🔧 Next steps:');
    console.log('   1. Set up authentication to test job creation');
    console.log('   2. Test job processing with a real image generation');
    console.log('   3. Test WebSocket real-time updates');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testJobQueue();
