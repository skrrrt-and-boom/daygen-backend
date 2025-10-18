// Test script for Seedance integration
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

async function testSeedanceIntegration() {
  console.log('Testing Seedance 1.0 Pro integration...');
  
  try {
    // Test 1: Create a Seedance video task
    console.log('\n1. Testing video creation...');
    const createResponse = await fetch(`${BASE_URL}/api/seedance-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'A cinematic dolly-in on a neon-lit street at night; shallow depth of field, reflective puddles, soft bokeh.',
        mode: 't2v',
        ratio: '16:9',
        duration: 5,
        resolution: '1080p',
        fps: 24,
        camerafixed: true,
        seed: '12345'
      })
    });

    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.error('❌ Create request failed:', createResponse.status, error);
      return;
    }

    const createResult = await createResponse.json();
    console.log('✅ Video creation successful:', createResult);

    if (!createResult.taskId) {
      console.error('❌ No task ID returned');
      return;
    }

    // Test 2: Poll the task status
    console.log('\n2. Testing task status polling...');
    const taskId = createResult.taskId;
    
    // Poll a few times to see the status
    for (let i = 0; i < 3; i++) {
      const statusResponse = await fetch(`${BASE_URL}/api/seedance-task?id=${encodeURIComponent(taskId)}`);
      
      if (!statusResponse.ok) {
        const error = await statusResponse.text();
        console.error('❌ Status request failed:', statusResponse.status, error);
        break;
      }

      const statusResult = await statusResponse.json();
      console.log(`✅ Status check ${i + 1}:`, statusResult);

      if (statusResult.status === 'succeeded' && statusResult.videoUrl) {
        console.log('🎉 Video generation completed!');
        console.log('Video URL:', statusResult.videoUrl);
        break;
      }

      // Wait 2 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('\n✅ Seedance integration test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testSeedanceIntegration();
