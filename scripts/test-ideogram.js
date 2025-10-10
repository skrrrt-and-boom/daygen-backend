// Simple test script for Ideogram integration (No AWS required)
// Run with: node test-ideogram.js

const testIdeogramGenerate = async () => {
  try {
    console.log('Testing Ideogram Generate endpoint...');
    
    const response = await fetch('http://localhost:3000/api/ideogram/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'A beautiful sunset over mountains',
        aspect_ratio: '16:9',
        rendering_speed: 'TURBO',
        num_images: 1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Ideogram Generate test passed!');
    console.log('Generated images:', result.dataUrls?.length || 0);
    
    if (result.dataUrls && result.dataUrls.length > 0) {
      console.log('First image is base64 data URL:', result.dataUrls[0].startsWith('data:image/'));
      console.log('Image size:', result.dataUrls[0].length, 'characters');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Ideogram Generate test failed:', error.message);
    return false;
  }
};

const testIdeogramDescribe = async () => {
  try {
    console.log('Testing Ideogram Describe endpoint...');
    
    // Create a simple test image (1x1 pixel PNG)
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 1, 1);
    
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const formData = new FormData();
    formData.append('image', blob, 'test.png');
    formData.append('model_version', 'V_3');

    const response = await fetch('http://localhost:3000/api/ideogram/describe', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Ideogram Describe test passed!');
    console.log('Descriptions:', result.descriptions?.length || 0);
    
    if (result.descriptions && result.descriptions.length > 0) {
      console.log('First description:', result.descriptions[0].text);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Ideogram Describe test failed:', error.message);
    return false;
  }
};

const runTests = async () => {
  console.log('🚀 Starting Ideogram integration tests...\n');
  
  const results = await Promise.all([
    testIdeogramGenerate(),
    testIdeogramDescribe()
  ]);
  
  const passed = results.filter(Boolean).length;
  const total = results.length;
  
  console.log(`\n📊 Test Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All tests passed! Ideogram integration is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Check the error messages above.');
  }
};

// Check if running in Node.js environment
if (typeof window === 'undefined') {
  // Node.js environment - use undici fetch
  import('undici').then(({ fetch }) => {
    global.fetch = fetch;
    runTests().catch(console.error);
  });
} else {
  // Browser environment
  runTests().catch(console.error);
}
